import Lenis from "lenis";
import { FRAG, SIM, VERT, injectCodec } from "./shaders";
import { bez, clampNum, hand, key } from "./motion";

/**
 * The engine behind the site background. Everything imperative lives
 * here: the WebGL2 setup, the ping-pong fluid, the camera move, the
 * wordmark layout, and the listeners. The React component only builds
 * the markup, hands over three elements, and calls destroy() on the way
 * out.
 *
 * If anything at all goes wrong (no WebGL2, a shader that will not
 * compile, a texture that will not load) the canvas hides itself and the
 * still poster underneath is what the visitor sees. That path is not a
 * nicety, it is the design.
 */

export type SceneSettings = {
  fluidStrength: number;
  fluidDecay: number;
  scrollSpeed: number;
  fogDensity: number;
  sunGlow: number;
};

export type SceneOptions = {
  canvas: HTMLCanvasElement;
  plate: HTMLImageElement | null;
  colorSrc: string;
  depthSrc: string;
  reduced: boolean;
  /** Read live, so a prop change lands on the next frame. */
  settings: () => SceneSettings;
  /** Fires only on the edge: true once the wordmark has reached its corner. */
  onPinned: (isPinned: boolean) => void;
};

export type Scene = {
  destroy: () => void;
};

type Target = {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
};

type Uniforms = Record<string, WebGLUniformLocation | null>;

/* Intrinsic size of /verdure-lockup.png. Only the centring maths reads it —
   the element itself is width-driven with height:auto. */
let MARK_RATIO = 319 / 478;
let MARK_W = 330;
let MARK_PIN_W = 96;
/** The wordmark finishes its travel a quarter of the way down the page. */
let PIN_AT = 0.25;
/** Hard pixel budget so a dense panel does not drop the frame rate. */
let PIXEL_BUDGET = 3.6e6;
/** The colour plate is downsampled to this before it becomes a texture. */
let PLATE_MAX_W = 2560;
/** Height wobble at or under this is a phone toolbar, not a real resize. */
let TOOLBAR_SLACK = 160;
/** Live scenes, so a deferred cleanup never reaches into a fresh instance. */
let liveScenes = 0;

/**
 * The scene lives in the root layout and runs behind every route, but the
 * travelling wordmark belongs to the homepage opening. The opening hands
 * its element over on mount and takes it back on unmount; every other page
 * simply never has one.
 */
let markEl: HTMLElement | null = null;

export function attachMark(el: HTMLElement | null): void
{
  markEl = el;
}

/**
 * Whether the plate is currently the subject rather than a ground.
 *
 * This is the difference between 60fps and about 13. A full-viewport
 * canvas that repaints every frame underneath a stack of translucent
 * surfaces forces the compositor to re-blend the whole viewport every
 * frame, and it cannot cache any of it. Measured on the content region:
 * 77ms a frame with the plate live, 17ms with it held still.
 *
 * So in the opening, where the plate is bare and IS the thing you are
 * looking at, it runs every frame. Under --page-tint, which keeps about a
 * fifth of it, it holds its last frame instead. A slow handheld drift at
 * a fifth opacity behind a wall of text is not something anyone can see
 * going still, and it buys back the entire frame budget.
 */
let exposed = false;

export function setPlateExposed(value: boolean): void
{
  exposed = value;
}

/**
 * The live Lenis instance, published so a route change can reach it.
 *
 * Lenis caches the document height and keeps its own target scroll offset.
 * Neither survives a client-side navigation: the router swaps the page for
 * one of a different height while Lenis still holds the offset it had on
 * the page you left. On the next frame it writes that stale offset back,
 * the browser clamps it to the new (shorter) document, and you land at the
 * bottom of a page you have never scrolled. Sub-pages are all shorter than
 * the 300vh opening, so the homepage footer is the worst case for it.
 */
let activeLenis: { resize: () => void; scrollTo: (t: number, o?: object) => void } | null = null;

/**
 * Put the site back at the top and re-measure, in that order. Called on
 * every route change that is not an in-page anchor.
 */
export function resetSiteScroll(): void
{
  if (typeof window === "undefined") return;

  window.scrollTo(0, 0);

  if (activeLenis)
  {
    // resize() first so the clamp Lenis applies to the jump is the new
    // page's height and not the one we just left.
    activeLenis.resize();
    activeLenis.scrollTo(0, { immediate: true, force: true });
  }
}

export function createScene(opts: SceneOptions): Scene
{
  let canvas = opts.canvas;

  let gl: WebGL2RenderingContext | null = null;
  let isFloat = false;
  let progMain: WebGLProgram | null = null;
  let progSim: WebGLProgram | null = null;
  let quad: WebGLBuffer | null = null;
  let texColor: WebGLTexture | null = null;
  let texDepth: WebGLTexture | null = null;
  let uMain: Uniforms = {};
  let uSim: Uniforms = {};
  let fieldA: Target | null = null;
  let fieldB: Target | null = null;
  let ro: ResizeObserver | null = null;
  let lenis: Lenis | null = null;

  let ready = false;
  let shown = false;
  let dead = false;
  let pinned = false;
  let raf = 0;
  let plateTimer = 0;
  let last = 0;

  let airT = 0;
  let camT = 0;
  let frame = 0;
  let scroll = 0;
  let scrollRaw = 0;
  let cssW = 0;
  let cssH = 0;
  let imgAsp = 1;

  /**
   * The viewport as of the last real resize. A phone toolbar sliding in and
   * out changes window.innerHeight by ~90px several times per scroll; if the
   * scroll denominator and the wordmark maths read that live, the camera
   * lurches and the mark hops every time the bar moves. These only follow a
   * resize that is actually a resize.
   */
  let viewW = 0;
  let viewH = 0;

  /** Last filter string written to the mark, so identical frames are free. */
  let lastFilter = "";

  let ptr = { x: 0.5, y: 0.5 };
  let ptrVel = { x: 0, y: 0 };
  let ptrT = 0;
  let cursor = { x: 0, y: 0 };
  let cursorTarget = { x: 0, y: 0 };

  // ---------------------------------------------------------------- fallback

  let fallback = function ()
  {
    canvas.style.display = "none";
  };

  // ------------------------------------------------------------------ scroll

  let readScroll = function ()
  {
    // scrollHeight is read live so content settling still counts; the
    // viewport half is the cached one, so toolbar wobble does not.
    let max = Math.max(1, document.documentElement.scrollHeight - (viewH || window.innerHeight));
    let y = window.scrollY || document.documentElement.scrollTop || 0;
    scrollRaw = Math.max(0, Math.min(1, y / max));
  };

  let pointer = function (cx: number, cy: number)
  {
    let w = window.innerWidth;
    let h = window.innerHeight;
    let x = cx / w;
    let y = 1 - cy / h;
    let now = performance.now();
    let dt = Math.max(0.008, Math.min(0.1, (now - (ptrT || now - 16)) / 1000));
    ptrT = now;
    ptrVel.x += (x - ptr.x) / dt * 0.06;
    ptrVel.y += (y - ptr.y) / dt * 0.06;
    ptr.x = x;
    ptr.y = y;
    cursorTarget.x = (x - 0.5) * 2;
    cursorTarget.y = (y - 0.5) * 2;
  };

  // ---------------------------------------------------------------- wordmark

  let setPinned = function (nowPinned: boolean)
  {
    if (nowPinned === pinned) return;
    pinned = nowPinned;
    opts.onPinned(pinned);
  };

  // the wordmark rides one continuous transform from centre to corner and
  // then stays pinned. it lives above the canvas so the water never bends it
  let layoutMark = function (force?: number)
  {
    let el = markEl;
    if (!el)
    {
      setPinned(scroll >= PIN_AT);
      return;
    }

    // Reduced motion gets the finished position with no travel at all.
    let s = opts.reduced ? 1 : (force != null ? force : scroll);
    let e = bez(Math.max(0, Math.min(1, s / PIN_AT)));
    // The mark's laid-out size, not a constant: CSS scales it down on a
    // phone, where the ported 330px would be most of the screen. Reading
    // it back keeps the scale maths honest whatever the stylesheet says.
    let W = el.offsetWidth || MARK_W;
    let H = el.offsetHeight || W * MARK_RATIO;
    let end = Math.min(MARK_PIN_W, W * 0.52) / W;
    let scale = 1 + (end - 1) * e;
    let vw = viewW || window.innerWidth;
    let vh = viewH || window.innerHeight;
    let pad = Math.max(24, Math.min(64, vw * 0.045));
    let x0 = (vw - W) / 2;
    let y0 = (vh - H) / 2;
    let x = x0 + (pad - x0) * e;
    let y = y0 + (pad * 0.8 - y0) * e;
    el.style.transform = "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0) scale(" + scale.toFixed(4) + ")";
    // Quantised on purpose. Three stacked drop-shadows are three blur
    // passes, and a filter whose radii change every frame has to be
    // re-rasterised every frame: measured, that alone was costing about
    // half the frame budget through the travel. In sixteenths the glow
    // still reads as continuous and the compositor gets to cache it.
    let lift = Math.round((1 - e) * 16) / 16;
    // The lockup is dark green now, so it needs a pale halo to hold it off
    // the sunlit field it opens over. A tight rim does the separating and
    // the wide one is atmosphere — one soft glow on its own only fogs the
    // letterforms. The dark shadow last is what still gives it lift.
    let filter =
      "drop-shadow(0 0 " + (2 + 2 * lift).toFixed(1) + "px rgba(250, 252, 246, " + (0.60 + 0.30 * lift).toFixed(3) + ")) " +
      "drop-shadow(0 0 " + (14 + 16 * lift).toFixed(1) + "px rgba(250, 252, 246, " + (0.34 + 0.34 * lift).toFixed(3) + ")) " +
      "drop-shadow(0 " + (1 + 2 * lift).toFixed(1) + "px " + (8 + 22 * lift).toFixed(1) + "px rgba(6, 14, 9, " + (0.18 + 0.30 * lift).toFixed(3) + "))";
    if (filter !== lastFilter)
    {
      lastFilter = filter;
      el.style.filter = filter;
    }

    // The handoff to the site chrome rides the real scroll, not the forced
    // position, so reduced motion still gets its corner wordmark first.
    setPinned(scroll >= PIN_AT);
  };

  // ------------------------------------------------------------------ render

  let makeTarget = function (g: WebGL2RenderingContext, w: number, h: number): Target | null
  {
    let tex = g.createTexture();
    let fb = g.createFramebuffer();
    if (!tex || !fb) return null;

    g.bindTexture(g.TEXTURE_2D, tex);
    if (isFloat) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, w, h, 0, g.RGBA, g.HALF_FLOAT, null);
    else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);

    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    g.clearColor(isFloat ? 0 : 0.5, isFloat ? 0 : 0.5, isFloat ? 0 : 0.5, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    return { tex: tex, fb: fb, w: w, h: h };
  };

  let dropTarget = function (g: WebGL2RenderingContext, t: Target | null)
  {
    if (!t) return;
    g.deleteFramebuffer(t.fb);
    g.deleteTexture(t.tex);
  };

  let resize = function ()
  {
    let g = gl;
    if (!g || dead) return;

    let w = canvas.clientWidth || window.innerWidth;
    let h = canvas.clientHeight || window.innerHeight;

    // A phone toolbar sliding away is a height-only change of roughly this
    // much, several times per scroll. Reallocating the drawing buffer and
    // both sim targets for that stutters the whole gesture, so the buffer
    // is left alone and only the aspect follows. The plate stretches by
    // under a toolbar's worth, which nobody can see; the realloc, they can.
    if (canvas.width > 2 && w === cssW && Math.abs(h - cssH) < TOOLBAR_SLACK)
    {
      cssH = h;
      layoutMark();
      return;
    }

    viewW = window.innerWidth;
    viewH = window.innerHeight;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w * h * dpr * dpr > PIXEL_BUDGET) dpr = Math.max(1, Math.sqrt(PIXEL_BUDGET / (w * h)));
    cssW = w;
    cssH = h;
    canvas.width = Math.max(2, Math.round(w * dpr));
    canvas.height = Math.max(2, Math.round(h * dpr));

    // the fluid runs at half resolution and is upsampled by the linear filter
    let sw = Math.max(64, Math.min(512, Math.round(canvas.width * 0.5)));
    let sh = Math.max(64, Math.min(512, Math.round(canvas.height * 0.5)));
    if (!fieldA || fieldA.w !== sw || fieldA.h !== sh)
    {
      dropTarget(g, fieldA);
      dropTarget(g, fieldB);
      fieldA = makeTarget(g, sw, sh);
      fieldB = makeTarget(g, sw, sh);
    }

    layoutMark();
  };

  let sim = function (g: WebGL2RenderingContext, dt: number, s: SceneSettings)
  {
    let src = fieldA;
    let dst = fieldB;
    if (!src || !dst) return;

    g.useProgram(progSim);
    g.bindFramebuffer(g.FRAMEBUFFER, dst.fb);
    g.viewport(0, 0, dst.w, dst.h);
    g.activeTexture(g.TEXTURE2);
    g.bindTexture(g.TEXTURE_2D, src.tex);
    g.uniform1i(uSim.uField, 2);
    g.uniform2f(uSim.uTexel, 1 / dst.w, 1 / dst.h);
    g.uniform2f(uSim.uPointer, ptr.x, ptr.y);
    let vx = ptrVel.x;
    let vy = ptrVel.y;
    let speed = Math.hypot(vx, vy);
    g.uniform2f(uSim.uPointerVel, vx, vy);
    g.uniform1f(uSim.uDt, dt);
    g.uniform1f(uSim.uDecay, clampNum(s.fluidDecay, 1.5, 0.4, 4));
    g.uniform1f(uSim.uForce, clampNum(s.fluidStrength, 1, 0, 2.5) * 1.35);
    g.uniform1f(uSim.uAspect, Math.max(0.2, (cssW || 1) / Math.max(1, cssH || 1)));
    // a flick tears a wider ripple than a slow drag
    g.uniform1f(uSim.uRadius, 0.085 + Math.min(0.16, speed * 0.09));
    g.drawArrays(g.TRIANGLES, 0, 3);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    fieldA = dst;
    fieldB = src;
    ptrVel.x *= 0.68;
    ptrVel.y *= 0.68;
  };

  let draw = function (g: WebGL2RenderingContext, s: SceneSettings)
  {
    let field = fieldA;
    if (!field) return;

    let sc = scroll;
    let t = camT;
    let TAU = Math.PI * 2;

    // one continuous move across the three pages: push in, travel through the
    // terrain, then lift into a wide calm hold
    let zoom = key(sc, [[0, 1.005], [0.33, 1.115], [0.66, 1.30], [1, 1.075]]);
    let panX = key(sc, [[0, -0.006], [0.33, 0.004], [0.66, 0.020], [1, 0.006]]);
    let panY = key(sc, [[0, 0.004], [0.33, -0.012], [0.66, -0.030], [1, 0.012]]);
    let fogS = key(sc, [[0, 0.92], [0.33, 1.20], [0.62, 1.55], [1, 0.72]]);
    let dofS = key(sc, [[0, 0.85], [0.33, 1.35], [0.66, 1.75], [1, 0.80]]);
    let expS = key(sc, [[0, 1.0], [0.33, 0.975], [0.66, 0.955], [1, 1.055]]);

    panX += 0.0055 * Math.sin(TAU * t / 137 + 0.7);
    panY += 0.0026 * Math.sin(TAU * t / 223 + 2.1);
    zoom += 0.006 - 0.006 * Math.cos(TAU * t / 180);

    let expo = expS;
    if (!opts.reduced)
    {
      let px = 1 / Math.max(600, cssW || 1200);
      let py = 1 / Math.max(400, cssH || 800);
      panX += hand(t, 0x1f35) * 2 * 3.4 * px;
      panY += hand(t + 41, 0x77a1) * 2 * 2.6 * py;
      zoom += hand(t + 93, 0x2bd9) * 2 * 0.0013;
      expo *= 1 + hand(t * 0.42 + 7, 0x5c07) * 2 * 0.022;
    }

    g.useProgram(progMain);
    g.viewport(0, 0, canvas.width, canvas.height);
    g.activeTexture(g.TEXTURE2);
    g.bindTexture(g.TEXTURE_2D, field.tex);
    g.uniform1i(uMain.uField, 2);
    g.uniform2f(uMain.uFieldTexel, 1 / field.w, 1 / field.h);
    g.uniform2f(uMain.uPan, panX, panY);
    g.uniform2f(uMain.uCursor, cursor.x, cursor.y);
    g.uniform1f(uMain.uZoom, zoom);
    g.uniform1f(uMain.uCanvasAsp, Math.max(0.2, (cssW || 1) / Math.max(1, cssH || 1)));
    g.uniform1f(uMain.uAir, airT);
    g.uniform1f(uMain.uFrame, frame % 1024);
    g.uniform1f(uMain.uFogK, clampNum(s.fogDensity, 1, 0, 2) * fogS);
    g.uniform1f(uMain.uGlowK, clampNum(s.sunGlow, 1, 0, 2));
    g.uniform1f(uMain.uGrainK, opts.reduced ? 0.5 : 1);
    g.uniform1f(uMain.uExposure, expo);
    g.uniform1f(uMain.uDofK, dofS);
    g.uniform1f(uMain.uRefract, opts.reduced ? 0 : clampNum(s.fluidStrength, 1, 0, 2.5));
    g.drawArrays(g.TRIANGLES, 0, 3);

    if (!shown)
    {
      shown = true;
      canvas.style.opacity = "1";
      plateTimer = window.setTimeout(function ()
      {
        if (opts.plate) opts.plate.style.opacity = "0";
      }, 60);
    }
  };

  // -------------------------------------------------------------- frame loop

  let step = function (dt: number)
  {
    let s = opts.settings();
    let speed = clampNum(s.scrollSpeed, 1, 0.4, 2.5);
    airT += dt;
    frame += 1;
    if (!opts.reduced) camT += dt;

    // the visual always trails the raw scroll a little
    let lag = 1 - Math.exp(-dt / (0.20 / speed));
    scroll += (scrollRaw - scroll) * lag;
    cursor.x += (cursorTarget.x - cursor.x) * 0.06;
    cursor.y += (cursorTarget.y - cursor.y) * 0.06;

    // The wordmark and the scroll easing run whether or not the canvas ever
    // came up, so the poster fallback keeps the same choreography.
    if (ready && gl)
    {
      if (!opts.reduced) sim(gl, dt, s);
      draw(gl, s);
    }

    layoutMark();
  };

  let loop = function (ts: number)
  {
    raf = requestAnimationFrame(loop);
    // Lenis is driven from this one loop, so it has to tick even on the
    // fallback path, and at full rate whatever the plate is doing, or
    // scrolling itself would go coarse.
    if (lenis) lenis.raf(ts);
    // The first frame always gets drawn, even on a route with no opening,
    // so what freezes is the graded plate and not the raw poster.
    if (!exposed && shown)
    {
      // Hold the last frame. Keeping the clock and the eased scroll in
      // sync means coming back into the opening resumes where the camera
      // actually is, instead of racing to catch up.
      last = ts;
      scroll = scrollRaw;
      return;
    }
    let dt = Math.min(0.05, Math.max(0.001, (ts - last) / 1000));
    last = ts;
    step(dt);
  };

  let start = function ()
  {
    if (dead || raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };

  let stop = function ()
  {
    if (raf)
    {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  // ---------------------------------------------------------------- textures

  /** Big source plates get scaled down once rather than on every upload. */
  let fit = function (img: HTMLImageElement, maxW: number): TexImageSource
  {
    if (img.naturalWidth <= maxW) return img;

    let c = document.createElement("canvas");
    c.width = maxW;
    c.height = Math.round(img.naturalHeight * maxW / img.naturalWidth);
    let ctx = c.getContext("2d");
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  };

  let loadImage = function (src: string): Promise<HTMLImageElement>
  {
    return new Promise(function (res, rej)
    {
      let im = new Image();
      im.onload = function () { res(im); };
      im.onerror = rej;
      im.src = src;
    });
  };

  let loadTextures = function (g: WebGL2RenderingContext)
  {
    Promise.all([loadImage(opts.colorSrc), loadImage(opts.depthSrc)]).then(function (images)
    {
      if (dead || !gl) return;
      let color = images[0];
      let depth = images[1];
      imgAsp = color.naturalWidth / color.naturalHeight;

      texColor = g.createTexture();
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, texColor);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
      g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, fit(color, PLATE_MAX_W));
      g.generateMipmap(g.TEXTURE_2D);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);

      texDepth = g.createTexture();
      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D, texDepth);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, depth);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);

      g.useProgram(progMain);
      g.uniform1i(uMain.uColor, 0);
      g.uniform1i(uMain.uDepth, 1);
      g.uniform1i(uMain.uField, 2);
      g.uniform1f(uMain.uImageAsp, imgAsp);
      g.useProgram(progSim);
      g.uniform1i(uSim.uField, 2);

      ready = true;
      start();
    }).catch(function ()
    {
      fallback();
    });
  };

  // -------------------------------------------------------------- gl bring-up

  let build = function (): boolean
  {
    let g = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!g) return false;

    gl = g;
    isFloat = !!g.getExtension("EXT_color_buffer_float");

    let compile = function (type: number, src: string): WebGLShader
    {
      let s = g.createShader(type);
      if (!s) throw new Error("shader alloc failed");
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(String(g.getShaderInfoLog(s)) + "\n" + src.slice(0, 300));
      return s;
    };

    let link = function (fs: string): WebGLProgram
    {
      let pr = g.createProgram();
      if (!pr) throw new Error("program alloc failed");
      g.attachShader(pr, compile(g.VERTEX_SHADER, VERT));
      g.attachShader(pr, compile(g.FRAGMENT_SHADER, fs));
      g.linkProgram(pr);
      if (!g.getProgramParameter(pr, g.LINK_STATUS)) throw new Error(String(g.getProgramInfoLog(pr)));
      return pr;
    };

    let mainProgram: WebGLProgram;
    let simProgram: WebGLProgram;
    try
    {
      mainProgram = link(injectCodec(FRAG, isFloat));
      simProgram = link(injectCodec(SIM, isFloat));
    }
    catch (err)
    {
      console.warn("verdure background", err);
      return false;
    }
    progMain = mainProgram;
    progSim = simProgram;

    quad = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    let programs = [mainProgram, simProgram];
    for (let i = 0; i < programs.length; i++)
    {
      let loc = g.getAttribLocation(programs[i], "aPos");
      g.bindBuffer(g.ARRAY_BUFFER, quad);
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    }

    let grab = function (pr: WebGLProgram, names: string[]): Uniforms
    {
      let out: Uniforms = {};
      for (let i = 0; i < names.length; i++)
      {
        out[names[i]] = g.getUniformLocation(pr, names[i]);
      }
      return out;
    };

    uMain = grab(mainProgram, ["uColor", "uDepth", "uField", "uFieldTexel", "uPan", "uCursor", "uZoom", "uCanvasAsp", "uImageAsp", "uAir", "uFrame", "uFogK", "uGlowK", "uGrainK", "uExposure", "uDofK", "uRefract"]);
    uSim = grab(simProgram, ["uField", "uTexel", "uPointer", "uPointerVel", "uDt", "uDecay", "uForce", "uAspect", "uRadius"]);

    ro = new ResizeObserver(function () { resize(); });
    ro.observe(canvas);
    resize();
    loadTextures(g);
    return true;
  };

  let releaseGL = function ()
  {
    let g = gl;
    if (!g) return;

    dropTarget(g, fieldA);
    dropTarget(g, fieldB);
    fieldA = null;
    fieldB = null;
    if (texColor) g.deleteTexture(texColor);
    if (texDepth) g.deleteTexture(texDepth);
    if (quad) g.deleteBuffer(quad);
    if (progMain) g.deleteProgram(progMain);
    if (progSim) g.deleteProgram(progSim);
    texColor = null;
    texDepth = null;
    quad = null;
    progMain = null;
    progSim = null;

    // Browsers only allow a handful of live contexts, so a route change has
    // to hand this one back rather than wait for the collector.
    let ext = g.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
    gl = null;
  };

  // --------------------------------------------------------------- listeners

  let onVis = function ()
  {
    if (document.hidden) stop();
    else start();
  };

  let onScroll = function ()
  {
    readScroll();
  };

  let onPointer = function (e: PointerEvent)
  {
    pointer(e.clientX, e.clientY);
  };

  let onTouch = function (e: TouchEvent)
  {
    if (e.touches && e.touches[0]) pointer(e.touches[0].clientX, e.touches[0].clientY);
  };

  let initLenis = function ()
  {
    let s = opts.settings();
    try
    {
      lenis = new Lenis({
        duration: 1.15 / clampNum(s.scrollSpeed, 1, 0.4, 2.5),
        smoothWheel: true,
        touchMultiplier: 1.6,
      });
      lenis.on("scroll", readScroll);
      activeLenis = lenis;
    }
    catch
    {
      // native scroll is the fallback
      lenis = null;
      activeLenis = null;
    }
  };

  /**
   * Lenis 1.1.14 leaves a 400ms velocity-reset timer running past its own
   * destroy(), and when that fires it writes its class back onto <html>.
   * Sweep once the timer has had time to go, unless another opening has
   * taken over in the meantime.
   */
  let sweepLenisClasses = function ()
  {
    window.setTimeout(function ()
    {
      if (liveScenes > 0) return;
      let cl = document.documentElement.classList;
      cl.remove("lenis", "lenis-smooth", "lenis-scrolling", "lenis-stopped", "lenis-locked");
    }, 700);
  };

  let destroy = function ()
  {
    if (dead) return;
    dead = true;
    liveScenes -= 1;
    stop();
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    window.removeEventListener("pointermove", onPointer);
    window.removeEventListener("touchmove", onTouch);
    if (ro)
    {
      ro.disconnect();
      ro = null;
    }
    if (plateTimer)
    {
      window.clearTimeout(plateTimer);
      plateTimer = 0;
    }
    if (lenis)
    {
      if (activeLenis === lenis) activeLenis = null;
      lenis.destroy();
      lenis = null;
      sweepLenisClasses();
    }
    releaseGL();
  };

  // ------------------------------------------------------------------- start

  liveScenes += 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  if (!opts.reduced)
  {
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
  }

  readScroll();
  layoutMark(opts.reduced ? 1 : 0);
  if (!opts.reduced) initLenis();
  if (!build()) fallback();
  start();

  return { destroy: destroy };
}
