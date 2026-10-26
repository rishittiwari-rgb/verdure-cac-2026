import SwiftUI
import SceneKit

// =====================================================================
//  VerdureMedallion3D — the signature 3D brand object.
//  A sculpted compass ring + tilted leaf rendered in SceneKit with clay
//  PBR materials, lit from the top-left to match the 2D clay light source.
//  Idle auto-spin, drag-to-spin, and a soft floating bob. Performance is
//  capped (60fps, 2× MSAA, pauses when offscreen, transparent backing).
// =====================================================================

struct VerdureMedallion3D: UIViewRepresentable {
    var autoSpin: Bool = true
    var interactive: Bool = true

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = Self.buildScene(into: context.coordinator)
        view.backgroundColor = .clear
        view.isOpaque = false
        view.antialiasingMode = .multisampling2X
        view.preferredFramesPerSecond = 60
        view.rendersContinuously = true
        view.autoenablesDefaultLighting = false

        if autoSpin { context.coordinator.startIdleSpin() }

        Self.configureTouches(view, interactive: interactive, coordinator: context.coordinator)
        context.coordinator.scnView = view
        return view
    }

    /// A decorative (non-interactive) medallion takes no touches, so a tap on it reaches the
    /// SwiftUI gesture behind it — the Daily Gem's reveal tap was sometimes absorbed by the SCNView.
    static func configureTouches(_ view: SCNView, interactive: Bool, coordinator: Coordinator) {
        view.isUserInteractionEnabled = interactive
        if interactive {
            let pan = UIPanGestureRecognizer(target: coordinator, action: #selector(Coordinator.handlePan(_:)))
            view.addGestureRecognizer(pan)
        }
    }

    func updateUIView(_ uiView: SCNView, context: Context) {}

    static func dismantleUIView(_ uiView: SCNView, coordinator: Coordinator) {
        uiView.isPlaying = false
        uiView.scene = nil
    }

    // MARK: - Scene construction

    static func buildScene(into coord: Coordinator) -> SCNScene {
        let scene = SCNScene()

        // Camera
        let camera = SCNCamera()
        camera.fieldOfView = 32
        camera.usesOrthographicProjection = false
        let camNode = SCNNode()
        camNode.camera = camera
        camNode.position = SCNVector3(0, 0, 9)
        scene.rootNode.addChildNode(camNode)

        // Lighting — single key light from TOP-LEFT (matches clay light source)
        let key = SCNLight(); key.type = .directional
        key.intensity = 900; key.color = UIColor(hex: 0xFFFDF2)
        let keyNode = SCNNode(); keyNode.light = key
        keyNode.eulerAngles = SCNVector3(-0.5, -0.7, 0)   // from upper-left
        scene.rootNode.addChildNode(keyNode)

        let fill = SCNLight(); fill.type = .omni
        fill.intensity = 320; fill.color = UIColor(hex: 0x9FE8DA)
        let fillNode = SCNNode(); fillNode.light = fill
        fillNode.position = SCNVector3(4, -3, 6)
        scene.rootNode.addChildNode(fillNode)

        let ambient = SCNLight(); ambient.type = .ambient
        ambient.intensity = 360; ambient.color = UIColor(hex: 0xDDE6CF)
        let ambNode = SCNNode(); ambNode.light = ambient
        scene.rootNode.addChildNode(ambNode)

        // Medallion group
        let group = SCNNode()
        coord.medallion = group
        scene.rootNode.addChildNode(group)

        // --- Compass ring (torus) ---
        let ring = SCNTorus(ringRadius: 2.05, pipeRadius: 0.26)
        ring.ringSegmentCount = 64; ring.pipeSegmentCount = 24
        ring.firstMaterial = clayMaterial(0x16BFA5, gloss: 0x7FF3E2, rough: 0.5)
        let ringNode = SCNNode(geometry: ring)
        ringNode.eulerAngles.x = .pi / 2          // face the camera
        group.addChildNode(ringNode)

        // --- Compass points (4 diamonds N/E/S/W) ---
        for i in 0..<4 {
            let diamond = SCNBox(width: 0.5, height: 0.5, length: 0.34, chamferRadius: 0.12)
            diamond.firstMaterial = clayMaterial(0x14532D, gloss: 0x39935C, rough: 0.55)
            let node = SCNNode(geometry: diamond)
            let angle = Float(i) * .pi / 2
            let r: Float = 2.05
            node.position = SCNVector3(cos(angle) * r, sin(angle) * r, 0)
            node.eulerAngles.z = .pi / 4          // rotate square → diamond
            node.scale = SCNVector3(1, 1.7, 1)    // elongate outward-ish
            node.eulerAngles.z = angle + .pi / 4
            group.addChildNode(node)
        }

        // --- Leaf (center, tilted, lime→green) ---
        let leafPath = UIBezierPath()
        leafPath.move(to: CGPoint(x: 0, y: 1.6))
        leafPath.addQuadCurve(to: CGPoint(x: 0, y: -1.6), controlPoint: CGPoint(x: 1.15, y: 0))
        leafPath.addQuadCurve(to: CGPoint(x: 0, y: 1.6), controlPoint: CGPoint(x: -1.15, y: 0))
        leafPath.flatness = 0.05
        let leaf = SCNShape(path: leafPath, extrusionDepth: 0.28)
        leaf.chamferRadius = 0.08
        let leafMat = clayMaterial(0x7FB935, gloss: 0xC7E66B, rough: 0.45)
        let leafBack = clayMaterial(0x4E8C2A, gloss: 0x7FB935, rough: 0.5)
        leaf.materials = [leafMat, leafBack, leafMat]
        let leafNode = SCNNode(geometry: leaf)
        leafNode.scale = SCNVector3(0.92, 0.92, 0.92)
        leafNode.eulerAngles = SCNVector3(0, 0, -Float.pi / 6)   // tilt like the logo
        leafNode.position.z = 0.18
        group.addChildNode(leafNode)

        // Central vein (thin spruce capsule)
        let vein = SCNCapsule(capRadius: 0.035, height: 2.7)
        vein.firstMaterial = clayMaterial(0x2E5E1E, gloss: 0x4E8C2A, rough: 0.5)
        let veinNode = SCNNode(geometry: vein)
        veinNode.eulerAngles.z = -Float.pi / 6
        veinNode.position.z = 0.34
        group.addChildNode(veinNode)

        // Slight resting tilt so the 3D reads immediately
        group.eulerAngles = SCNVector3(0.18, -0.32, 0)
        return scene
    }

    /// A clay-like PBR material: matte body with a soft gloss highlight.
    static func clayMaterial(_ hex: UInt, gloss: UInt, rough: CGFloat) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        m.diffuse.contents = UIColor(hex: hex)
        m.roughness.contents = rough
        m.metalness.contents = 0.0
        m.specular.contents = UIColor(hex: gloss).withAlphaComponent(0.5)
        m.emission.contents = UIColor(hex: gloss).withAlphaComponent(0.06)
        return m
    }

    // MARK: - Coordinator

    @MainActor
    final class Coordinator: NSObject {
        weak var scnView: SCNView?
        var medallion: SCNNode?
        private var spinning = false

        func startIdleSpin() {
            guard !QAMotion.disabled else { return }
            guard let medallion, medallion.parent != nil, !spinning else { return }
            spinning = true
            let spin = SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 22)
            medallion.runAction(.repeatForever(spin), forKey: "idle")
        }

        @objc func handlePan(_ g: UIPanGestureRecognizer) {
            // Everything here runs on the main thread (gesture callback). Guard the
            // node so a torn-down view (tab switch / scroll-off) can't crash us.
            guard let medallion, medallion.parent != nil, let view = g.view else { return }
            let t = g.translation(in: view)
            switch g.state {
            case .began:
                medallion.removeAllActions()
                spinning = false
                Haptics.soft()
            case .changed:
                var e = medallion.eulerAngles
                e.y += Float(t.x) * 0.01
                e.x = max(-1.2, min(1.2, e.x + Float(t.y) * 0.01))   // clamp pitch
                medallion.eulerAngles = e
                g.setTranslation(.zero, in: view)
            case .ended, .cancelled, .failed:
                // Resume the idle spin from wherever the user left it. No completion
                // closures / thread hops — those were the crash vector.
                startIdleSpin()
            default: break
            }
        }
    }
}

// MARK: - Hosting wrapper (pauses rendering offscreen)

struct MedallionHero: View {
    var size: CGFloat = 260
    var autoSpin: Bool = true
    var interactive: Bool = true
    var body: some View {
        VerdureMedallion3D(autoSpin: autoSpin, interactive: interactive)
            .frame(width: size, height: size)
            .idleFloat(distance: 6, duration: 4)
    }
}

// =====================================================================
//  ClayMedallion — lightweight faux-3D SwiftUI mark (no SceneKit cost).
//  Compass ring + leaf drawn with clay shading; tilts with the gyro.
// =====================================================================

struct ClayMedallion: View {
    var size: CGFloat = 120
    var spin: Bool = false
    @State private var rot: Double = 0
    var body: some View {
        ZStack {
            // Compass ring
            Circle()
                .stroke(Palette.teal.faceGradient, lineWidth: size * 0.11)
                .frame(width: size * 0.82, height: size * 0.82)
                .shadow(color: Palette.teal.depth.opacity(0.5), radius: 6, x: 4, y: 4)
                .shadow(color: Palette.surfaceLight, radius: 5, x: -3, y: -3)

            // Compass points
            ForEach(0..<4, id: \.self) { i in
                RoundedRectangle(cornerRadius: size * 0.03, style: .continuous)
                    .fill(Palette.spruce.faceGradient)
                    .frame(width: size * 0.10, height: size * 0.20)
                    .offset(y: -size * 0.41)
                    .rotationEffect(.degrees(Double(i) * 90))
            }
            .rotationEffect(.degrees(45))

            // Leaf
            LeafShape()
                .fill(LinearGradient(colors: [Color(hex: 0xC7E66B), Color(hex: 0x7FB935), Color(hex: 0x4E8C2A)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: size * 0.34, height: size * 0.62)
                .rotationEffect(.degrees(-30))
                .shadow(color: Color(hex: 0x2E5E1E).opacity(0.5), radius: 4, x: 3, y: 3)
        }
        .frame(width: size, height: size)
        .rotation3DEffect(.degrees(rot), axis: (0, 1, 0))
        .onAppear {
            if spin {
                if !QAMotion.disabled { withAnimation(.linear(duration: 18).repeatForever(autoreverses: false)) { rot = 360 } }
            }
        }
    }
}

struct LeafShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let w = rect.width, h = rect.height
        p.move(to: CGPoint(x: w / 2, y: 0))
        p.addQuadCurve(to: CGPoint(x: w / 2, y: h), control: CGPoint(x: w, y: h * 0.5))
        p.addQuadCurve(to: CGPoint(x: w / 2, y: 0), control: CGPoint(x: 0, y: h * 0.5))
        p.closeSubpath()
        return p
    }
}
