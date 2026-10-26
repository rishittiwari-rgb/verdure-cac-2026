/**
 * The GLSL for the site background. Raw WebGL2, GLSL ES 300, no engine.
 *
 * Two programs share one full-screen triangle: SIM runs a ping-pong
 * velocity field the cursor pushes into, and FRAG paints the plate with
 * the depth parallax, the fluid distortion, fog, grain, bloom and lens.
 * Both are the design source unchanged; only the ENC/DEC codec below is
 * assembled at runtime.
 */

export let VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// velocity field: rg is flow, b is crest energy. it advects itself, spreads a
// little and decays, so a wake keeps travelling after the cursor has gone
export let SIM = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uField;
uniform vec2 uTexel;
uniform vec2 uPointer;
uniform vec2 uPointerVel;
uniform float uDt;
uniform float uDecay;
uniform float uForce;
uniform float uAspect;
uniform float uRadius;

vec3 fld(vec2 uv){ return DEC(texture(uField, clamp(uv, uTexel, 1.0 - uTexel)).xyz); }

void main(){
  vec3 here = fld(vUv);
  vec3 f = fld(vUv - here.xy * uDt * 0.42);
  vec3 blur = (fld(vUv + vec2(uTexel.x, 0.0)) + fld(vUv - vec2(uTexel.x, 0.0))
             + fld(vUv + vec2(0.0, uTexel.y)) + fld(vUv - vec2(0.0, uTexel.y))) * 0.25;
  f = mix(f, blur, 0.16);
  f *= exp(-uDt / max(0.15, uDecay));

  vec2 d = (vUv - uPointer) * vec2(uAspect, 1.0);
  float fall = exp(-dot(d, d) / (uRadius * uRadius));
  f.xy += uPointerVel * fall * uForce * uDt;
  f.z = max(f.z * 0.985, length(uPointerVel) * fall * 0.35);

  f.xy = clamp(f.xy, vec2(-0.98), vec2(0.98));
  f.z = clamp(f.z, 0.0, 0.98);
  fragColor = vec4(ENC(f), 1.0);
}`;

export let FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform sampler2D uField;
uniform vec2  uFieldTexel;
uniform vec2  uPan;
uniform vec2  uCursor;
uniform float uZoom;
uniform float uCanvasAsp;
uniform float uImageAsp;
uniform float uAir;
uniform float uFrame;
uniform float uFogK;
uniform float uGlowK;
uniform float uGrainK;
uniform float uExposure;
uniform float uDofK;
uniform float uRefract;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float PIVOT = 0.44;

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.07 + 3.1; a *= 0.5; }
  return s;
}
// the plate depth map is white for far, so it gets flipped and contrast
// expanded to keep the ridge boundaries narrow instead of smeared
float nearAt(vec2 uv){
  float d = 1.0 - texture(uDepth, uv).r;
  return clamp((d - 0.5) * 1.28 + 0.5, 0.0, 1.0);
}
vec2 coverUV(vec2 p){
  vec2 s = (uCanvasAsp > uImageAsp) ? vec2(1.0, uImageAsp / uCanvasAsp) : vec2(uCanvasAsp / uImageAsp, 1.0);
  return 0.5 + (p - 0.5) * s;
}
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float mote(vec2 sp, float cells, float drift, float size, float gate){
  vec2 g = sp * cells + vec2(uAir * drift, uAir * drift * 0.31);
  vec2 id = floor(g), f = fract(g);
  vec2 o = vec2(hash21(id + 3.1), hash21(id + 11.7));
  return step(gate, hash21(id + 27.3)) * smoothstep(size, 0.0, length(f - o));
}

void main(){
  vec2 p = vUv;

  vec3 fc = DEC(texture(uField, p).xyz);
  vec3 fR = DEC(texture(uField, p + vec2(uFieldTexel.x, 0.0)).xyz);
  vec3 fU = DEC(texture(uField, p + vec2(0.0, uFieldTexel.y)).xyz);
  float m0 = length(fc.xy);
  vec2 grad = vec2(length(fR.xy) - m0, length(fU.xy) - m0);
  float crest = clamp(length(grad) * 3.0 + fc.z * 0.5, 0.0, 1.0);
  p -= (fc.xy * 0.055 + grad * 0.16) * uRefract;

  vec2 q = (p - 0.5) * vec2(uCanvasAsp, 1.0);
  float r2 = dot(q, q);
  // r^4 falloff keeps the glass character in the corners only
  p += (p - 0.5) * (0.034 * r2 * r2);
  p = 0.5 + (p - 0.5) / uZoom + uPan + uCursor * 0.010;

  vec2 uv0 = coverUV(p);
  vec2 push = (uPan + uCursor * 0.016) * 1.25 - (uv0 - 0.5) * (uZoom - 1.0) * 0.85;
  vec2 uv = uv0;
  for (int i = 0; i < 4; i++){
    uv = uv0 + (nearAt(uv) - PIVOT) * push;
  }
  float nr = nearAt(uv);
  float far = 1.0 - nr;

  float coc = max(smoothstep(0.66, 1.0, nr) * 0.85, smoothstep(0.74, 1.0, far) * 0.5) * uDofK;
  float lod = coc * 2.3 + crest * 0.55;
  vec2 ca = normalize(q + 1e-6) * (0.00058 * r2 * r2) + grad * 0.0022 * uRefract;
  vec3 col = vec3(
    textureLod(uColor, uv + ca, lod).r,
    textureLod(uColor, uv, lod).g,
    textureLod(uColor, uv - ca, lod).b
  );

  vec2 wuv = uv * vec2(uImageAsp, 1.0);
  float shadowN = fbm(wuv * 2.4 + vec2(uAir * 0.0062, uAir * 0.0019));
  float shade = smoothstep(0.44, 0.82, shadowN);
  float terrain = smoothstep(0.14, 0.46, nr);
  col *= mix(1.0, 0.905, shade * terrain);
  col = mix(col, col * vec3(0.965, 0.99, 1.035), shade * terrain * 0.55);

  float drift = fbm(wuv * 1.6 + vec2(uAir * 0.0037, uAir * -0.0012));
  float aerial = clamp(smoothstep(0.26, 0.98, far) * (0.20 + 0.15 * drift) * uFogK, 0.0, 0.82);
  col = mix(col, vec3(0.665, 0.700, 0.735) * (0.97 + 0.05 * drift), aerial);
  float lum = dot(col, LUMA);
  col = mix(vec3(lum), col, 1.0 - 0.40 * aerial);
  col = mix(col, mix(vec3(lum), col, 1.16), smoothstep(0.42, 0.95, nr) * 0.55);

  vec3 wide = textureLod(uColor, uv, 5.0).rgb;
  float bright = max(dot(wide, LUMA) - 0.52, 0.0);
  float halo = exp(-length((uv - vec2(0.22, 0.90)) * vec2(uImageAsp, 1.0)) * 2.5);
  col += (wide * bright * 1.35 + vec3(1.0, 0.955, 0.87) * halo * 0.075) * uGlowK;
  col += vec3(1.0, 0.995, 0.98) * crest * crest * 0.045;

  vec2 sp = vUv * vec2(uCanvasAsp, 1.0);
  float lit = 0.35 + 0.65 * halo;
  float dust = mote(sp + uPan * 6.0, 9.0, 0.010, 0.055, 0.945) * 0.030
             + mote(sp + uPan * 2.4, 17.0, 0.006, 0.032, 0.955) * 0.022
             + mote(sp + uPan * 0.8, 29.0, 0.004, 0.020, 0.968) * 0.015;
  col += vec3(1.0, 0.98, 0.94) * dust * lit;

  col = aces(col * uExposure);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col *= 1.0 - 0.17 * smoothstep(0.30, 1.30, r2);

  float g = hash21(gl_FragCoord.xy * 0.41 + vec2(uFrame * 1.37, uFrame * 0.79));
  col += (g - 0.5) * uGrainK * mix(0.052, 0.014, smoothstep(0.0, 0.72, dot(col, LUMA)));

  fragColor = vec4(col, 1.0);
}`;

/**
 * Half-float targets hold the signed velocity field as-is. Where
 * EXT_color_buffer_float is missing the field has to ride in an 8-bit
 * target instead, so it gets packed into 0..1 on write and unpacked on
 * read. Only the two fragment programs carry the codec.
 */
export function injectCodec(src: string, isFloat: boolean): string
{
  let codec = isFloat
    ? "#define ENC(v) (v)\n#define DEC(v) (v)\n"
    : "#define ENC(v) ((v) * 0.5 + 0.5)\n#define DEC(v) ((v) * 2.0 - 1.0)\n";

  return src.replace("precision highp float;", "precision highp float;\n" + codec);
}
