import SwiftUI

struct CommunityView: View {
    @Environment(FirestoreService.self) private var firestore
    @Environment(AuthService.self) private var authService
    @Environment(ModerationService.self) private var moderation
    @State private var posts: [CommunityPost] = []
    @State private var loadedRemote = false
    @State private var newPostText = ""
    @State private var showNewPost = false
    @State private var selectedProfile: CommunityProfile?

    /// Posts shown in the feed: real Firestore posts when any exist; the sample
    /// starter feed only as a cold-start placeholder (never mixed together).
    private var feedPosts: [CommunityPost] {
        // Fixture posts exist only for the DEBUG QA harness; live builds show
        // the honest empty state until real neighbours post.
        let source = (posts.isEmpty && SampleData.isEnabled) ? SampleData.communityPosts : posts
        // Blocked authors never render, even before the server-side copy of the
        // block has propagated — the local cache decides instantly.
        return source.filter { !moderation.isBlocked($0.authorID) }
    }
    private var isShowingSamples: Bool { posts.isEmpty && SampleData.isEnabled }

    /// Load real community posts from Firestore (requires auth for reads).
    private func loadPosts() async {
        if QAData.offline { loadedRemote = true; return }   // QA: sample feed
        let remote = await firestore.fetchRecentPosts()
        loadedRemote = true
        if !remote.isEmpty { posts = remote }
    }

    // MARK: Derived — real data only

    private var myInitials: String { authService.currentUser?.initials ?? "ME" }
    private var myName: String { authService.currentUser?.displayName ?? "You" }

    /// Story rail = the actual authors in the feed (deduped, excluding you).
    private var feedAuthors: [(initials: String, name: String)] {
        var seen = Set<String>()
        var result: [(String, String)] = []
        for post in feedPosts where post.authorName != myName && seen.insert(post.authorName).inserted {
            result.append((post.authorInitials, post.authorName.components(separatedBy: " ").first ?? post.authorName))
        }
        return Array(result.prefix(8))
    }

    /// Trending = the places actually being posted about, by frequency.
    private var trendingPlaces: [String] {
        var counts: [String: Int] = [:]
        for post in feedPosts where !post.placeName.isEmpty && post.placeName != "Nearby" {
            counts[post.placeName, default: 0] += 1
        }
        return counts.sorted { $0.value > $1.value }.map(\.key)
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        header.dramaticRise(index: 0)
                        storyRail.dramaticRise(index: 1)
                        if trendingPlaces.count >= 2 { trendingTicker.dramaticRise(index: 2) }
                        feed
                    }
                    .padding(.top, Spacing.sm)
                    .padding(.bottom, 110)
                }
                .background(VerdureBackground())
                composeFAB
            }
            .sheet(isPresented: $showNewPost) {
                newPostSheet.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
            }
            .sheet(item: $selectedProfile) { profile in
                CommunityProfileSheet(profile: profile,
                                      posts: feedPosts.filter { $0.authorName == profile.name })
            }
            .task { await loadPosts() }
            .refreshable { await loadPosts() }
        }
    }

    private func kind(for index: Int) -> ClayStyle.ClayAccentKind {
        .spruce
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            KickerLabel(text: "What's blooming nearby", dot: Palette.gold.base)
            Text("Community").font(VType.display(44, .bold)).foregroundStyle(Palette.ink)
                .lineLimit(1).minimumScaleFactor(0.7)
            HStack(spacing: 6) {
                Circle().fill(Palette.teal.base).frame(width: 8, height: 8).breathing(scale: 1.4, duration: 1.4)
                if isShowingSamples {
                    Text("Starter stories — yours will replace them")
                        .font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
                } else if posts.isEmpty {
                    Text(loadedRemote ? "Nobody has posted nearby yet" : "Loading the neighborhood…")
                        .font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
                } else {
                    CountUp(value: posts.count).font(VType.num(14, .bold)).foregroundStyle(Palette.ink)
                    Text(posts.count == 1 ? "recent post nearby" : "recent posts nearby")
                        .font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
                }
            }
        }
        .padding(.horizontal, Spacing.md)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Story rail (real authors from the feed)

    private var storyRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                StoryRing(initials: myInitials, name: "Your story", accent: Palette.spruce, isYou: true)
                    .onTapGesture { Haptics.tap(); showNewPost = true }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Share your story")
                    .accessibilityHint("Opens the new post composer.")
                    .accessibilityAddTraits(.isButton)
                ForEach(Array(feedAuthors.enumerated()), id: \.offset) { i, author in
                    let accent = Palette.spruce
                    StoryRing(initials: author.initials, name: author.name, accent: accent, isYou: false)
                        .onTapGesture {
                            Haptics.soft()
                            let match = feedPosts.first { $0.authorInitials == author.initials }
                            selectedProfile = CommunityProfile(
                                name: match?.authorName ?? author.name,
                                initials: author.initials, accent: accent, uid: match?.authorID)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("View \(author.name)'s posts")
                        .accessibilityAddTraits(.isButton)
                }
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, 4)
        }
    }

    // MARK: - Trending (real place frequency from posts)

    private var trendingTicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TRENDING").font(VType.body(10, .bold)).tracking(1.6)
                .foregroundStyle(Palette.inkSoft).padding(.horizontal, Spacing.md)
            Marquee(spacing: 12, speed: 36) {
                HStack(spacing: 12) {
                    ForEach(Array(trendingPlaces.enumerated()), id: \.offset) { i, t in
                        HStack(spacing: 6) {
                            Image(systemName: "flame.fill").font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Palette.spruce.base)
                            Text(t).font(VType.body(13, .semibold)).foregroundStyle(Palette.ink)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.4))
                    }
                }
            }
            .frame(height: 40)
        }
    }

    // MARK: - Feed (staggered / broken grid)

    private var feed: some View {
        LazyVStack(spacing: 18) {
            if feedPosts.isEmpty && loadedRemote {
                EmptyStateCard(icon: "bubble.left.and.bubble.right",
                               title: "Be the first to post",
                               message: "Share a place you found, a trail worth the walk, or an event worth showing up for. Real neighbours, real posts — nothing here is staged.")
                    .padding(.horizontal, Spacing.md)
            }
            ForEach(Array(feedPosts.enumerated()), id: \.element.id) { i, post in
                HStack(spacing: 0) {
                    if i % 2 == 1 { Spacer(minLength: 26) }
                    PostCard(post: post, accent: kind(for: i)) {
                        guard post.authorName != myName else { return }
                        Haptics.soft()
                        selectedProfile = CommunityProfile(name: post.authorName,
                                                           initials: post.authorInitials,
                                                           accent: kind(for: i).accent,
                                                           uid: post.authorID)
                    } onLike: {
                        // Real like: persists to Firestore (rules allow +1 on likeCount).
                        if let docID = post.docID {
                            Task { await firestore.likePost(docID: docID) }
                        }
                    }
                        .rotationEffect(.degrees(i % 2 == 0 ? -1.2 : 1.2))
                    if i % 2 == 0 { Spacer(minLength: 26) }
                }
                .padding(.horizontal, Spacing.md)
                .scrollTransition(.animated(.spring(response: 0.5, dampingFraction: 0.8))) { c, phase in
                    c.opacity(phase.isIdentity ? 1 : 0)
                     .offset(y: phase.isIdentity ? 0 : 34)
                     .scaleEffect(phase.isIdentity ? 1 : 0.9)
                }
            }
        }
    }

    // MARK: - Compose FAB

    private var composeFAB: some View {
        Button { Haptics.tap(); showNewPost = true } label: {
            Image(systemName: "square.and.pencil").font(.system(size: 22, weight: .bold))
                .foregroundStyle(Palette.spruce.onColor)
                .frame(width: 62, height: 62)
                .background(ClayBackground(style: .accent(.spruce), radius: Radius.md, elevation: 0.9))
        }
        .buttonStyle(.plain)
        .breathing(scale: 1.06, duration: 2.2)
        .padding(.trailing, Spacing.lg)
        .padding(.bottom, 100)
        .accessibilityLabel("New post")
    }

    // MARK: - New post sheet

    private var newPostSheet: some View {
        NavigationStack {
            ZStack {
                VerdureBackground()
                VStack(alignment: .leading, spacing: Spacing.md) {
                    HStack(spacing: Spacing.sm) {
                        AvatarCircle(initials: myInitials, size: 42, accent: Palette.teal)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(myName).font(VType.display(15, .semibold)).foregroundStyle(Palette.ink)
                            Text(authService.isAuthenticated ? "Posting to the neighborhood"
                                                             : "Sign in to share with the neighborhood")
                                .font(VType.body(12)).foregroundStyle(Palette.inkSoft)
                        }
                        Spacer()
                    }
                    TextField("What did you discover today?", text: $newPostText, axis: .vertical)
                        .font(VType.body(16)).foregroundStyle(Palette.ink)
                        .lineLimit(5...10).padding(14)
                        .background(ClayBackground(style: .inset, radius: Radius.sm))
                    ClayButton("Share Post", systemImage: "paperplane.fill", kind: .spruce, fullWidth: true) { post() }
                        .disabled(newPostText.trimmingCharacters(in: .whitespaces).isEmpty || !authService.isAuthenticated)
                        .opacity(newPostText.trimmingCharacters(in: .whitespaces).isEmpty || !authService.isAuthenticated ? 0.5 : 1)
                    Spacer()
                }
                .padding(Spacing.md)
            }
            .navigationTitle("New Post").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { showNewPost = false }.foregroundStyle(Palette.inkSoft)
                }
            }
        }
    }

    private func post() {
        let text = newPostText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, let uid = authService.currentUser?.uid else { return }
        let new = CommunityPost(authorName: myName, authorInitials: myInitials,
                                placeName: "Your neighborhood", content: text,
                                timeAgo: "now", likeCount: 0, commentCount: 0, imagePlaceholder: nil)
        // Optimistic local insert for instant UI…
        withAnimation(.spring(response: 0.5, dampingFraction: 0.78)) { posts.insert(new, at: 0) }
        newPostText = ""
        Haptics.success()
        showNewPost = false
        // …then persist to Firestore so it's shared.
        Task {
            _ = await firestore.createPost(authorID: uid, authorName: myName,
                                           authorInitials: myInitials,
                                           placeName: "Your neighborhood", content: text)
            await loadPosts()   // pick up the server copy (with its docID for likes)
        }
    }
}

// MARK: - Story ring (continuously rotating gradient)

private struct StoryRing: View {
    let initials: String
    let name: String
    let accent: ClayAccent
    let isYou: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var rot = false

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .stroke(AngularGradient(colors: [accent.base, accent.gloss, accent.depth, accent.base],
                                            center: .center), lineWidth: 3.5)
                    .frame(width: 66, height: 66)
                    .rotationEffect(.degrees(rot ? 360 : 0))
                if isYou {
                    Image(systemName: "plus").font(.system(size: 22, weight: .bold))
                        .foregroundStyle(accent.onColor)
                        .frame(width: 56, height: 56)
                        .background(ClayBackground(style: .accent(.spruce), radius: 28, elevation: 0.4))
                } else {
                    AvatarCircle(initials: initials, size: 56, accent: accent)
                }
            }
            .breathing(scale: 1.03, duration: 2.4)
            Text(name).font(VType.body(11, .medium)).foregroundStyle(Palette.inkSoft)
                .lineLimit(1).minimumScaleFactor(0.75)
        }
        .frame(width: 72)
        .onAppear {
            guard !reduceMotion, !QAMotion.disabled else { return }
            withAnimation(.linear(duration: 7).repeatForever(autoreverses: false)) { rot = true }
        }
    }
}

// MARK: - Post card (oversized author, animated like)

private struct PostCard: View {
    let post: CommunityPost
    let accent: ClayStyle.ClayAccentKind
    var onProfile: () -> Void = {}
    var onLike: () -> Void = {}
    @State private var liked = false
    @State private var bump = false
    @State private var burst = false

    private var likeCount: Int { post.likeCount + (liked ? 1 : 0) }

    /// Local persisted set of liked posts, so hearts survive relaunches and the
    /// same post can't be liked twice from this device.
    private static let likedKey = "likedPostIDs"
    private static func likedSet() -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: likedKey) ?? [])
    }
    private static func markLiked(_ id: String) {
        UserDefaults.standard.set(Array(likedSet().union([id])), forKey: likedKey)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.sm) {
                Button(action: onProfile) {
                    HStack(spacing: Spacing.sm) {
                        AvatarCircle(initials: post.authorInitials, size: 44, accent: accent.accent)
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 4) {
                                Text(post.authorName).font(VType.display(20, .semibold)).foregroundStyle(Palette.ink)
                                Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(Palette.inkFaint)
                            }
                            HStack(spacing: 4) {
                                Image(systemName: "mappin").font(.system(size: 9, weight: .bold))
                                Text(post.placeName).font(VType.body(12, .semibold))
                            }
                            .foregroundStyle(accent.accent.base)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(post.authorName), posted at \(post.placeName)")
                Spacer()
                Text(post.timeAgo).font(VType.body(12, .medium)).foregroundStyle(Palette.inkFaint)
                // Report / Block — only on real (Firestore) posts; samples have no id.
                if let docID = post.docID {
                    ContentActionsMenu(target: .post, targetID: docID, targetLabel: "this post",
                                       author: post.authorID.map { (uid: $0, name: post.authorName) })
                }
            }

            Text(post.content).font(VType.body(15)).foregroundStyle(Palette.ink).lineSpacing(3)

            HStack(spacing: Spacing.lg) {
                likeButton
                Spacer()
            }
        }
        .padding(Spacing.md)
        .claySurface(.surface, radius: Radius.md, elevation: 0.9)
        .overlay(alignment: .leading) {
            Capsule().fill(accent.accent.faceGradient)
                .frame(width: 4).padding(.vertical, Spacing.md).padding(.leading, 4).opacity(0.6)
        }
        .onAppear {
            if let docID = post.docID, Self.likedSet().contains(docID) { liked = true }
        }
    }

    private var likeButton: some View {
        Button {
            guard !liked else { return }   // one like per device
            liked = true
            if let docID = post.docID { Self.markLiked(docID) }
            onLike()
            Haptics.soft()
            withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) { bump.toggle() }
            burst = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { burst = false }
        } label: {
            HStack(spacing: 5) {
                ZStack {
                    if burst {
                        Circle().stroke(Palette.terracotta.base, lineWidth: 2)
                            .frame(width: 30, height: 30)
                            .scaleEffect(burst ? 1.8 : 0.4).opacity(burst ? 0 : 0.9)
                            .animation(.easeOut(duration: 0.55), value: burst)
                    }
                    Image(systemName: liked ? "heart.fill" : "heart")
                        .font(.system(size: 16, weight: .bold))
                        .scaleEffect(bump ? 1.35 : 1)
                }
                Text("\(likeCount)").font(VType.num(13, .semibold))
                    .contentTransition(.numericText())
            }
            .foregroundStyle(liked ? Palette.terracotta.base : Palette.inkSoft)
            .frame(minWidth: 44, minHeight: 44)   // a11y hit target
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(liked ? "Liked, \(likeCount) likes" : "Like, \(likeCount) likes")
        .accessibilityAddTraits(.isButton)
    }
}

#Preview {
    CommunityView()
        .environment(FirestoreService())
        .environment(AuthService())
        .environment(ModerationService())
}

// MARK: - Community member profile (tap a story / post author)

struct CommunityProfile: Identifiable {
    let id = UUID()
    let name: String
    let initials: String
    let accent: ClayAccent
    var uid: String? = nil   // Firebase uid when known — enables Block / Report
}

/// Honest member sheet: shows only what we actually know — the member's posts
/// from the current feed. (No fabricated levels/stats/follow mechanics.)
struct CommunityProfileSheet: View {
    let profile: CommunityProfile
    var posts: [CommunityPost] = []
    @Environment(\.dismiss) private var dismiss
    @Environment(ModerationService.self) private var moderation
    @State private var showReport = false
    @State private var showBlockConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: Spacing.lg) {
                    VStack(spacing: Spacing.md) {
                        ZStack {
                            PulseHalo(color: profile.accent.base.opacity(0.5), size: 120, lineWidth: 2)
                            AvatarCircle(initials: profile.initials, size: 96, accent: profile.accent)
                                .idleFloat(distance: 4, duration: 3)
                        }
                        .frame(height: 124).padding(.top, Spacing.sm)
                        Text(profile.name).font(VType.display(28, .bold)).foregroundStyle(Palette.ink)
                        Text(posts.count == 1 ? "1 post in the neighborhood feed"
                                              : "\(posts.count) posts in the neighborhood feed")
                            .font(VType.body(13, .medium)).foregroundStyle(Palette.inkSoft)
                    }

                    if let uid = profile.uid {
                        HStack(spacing: 10) {
                            Button { Haptics.tap(); showReport = true } label: {
                                Label("Report", systemImage: "flag")
                                    .font(VType.body(13, .semibold)).foregroundStyle(Palette.ink)
                                    .padding(.horizontal, 14).padding(.vertical, 10)
                                    .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Report \(profile.name)")
                            if moderation.isBlocked(uid) {
                                Button { Haptics.tap(); Task { _ = await moderation.unblock(uid: uid) } } label: {
                                    Label("Unblock", systemImage: "hand.raised.slash")
                                        .font(VType.body(13, .semibold)).foregroundStyle(Palette.ink)
                                        .padding(.horizontal, 14).padding(.vertical, 10)
                                        .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
                                }
                                .buttonStyle(.plain)
                            } else {
                                Button { Haptics.tap(); showBlockConfirm = true } label: {
                                    Label("Block", systemImage: "hand.raised")
                                        .font(VType.body(13, .semibold)).foregroundStyle(Palette.danger)
                                        .padding(.horizontal, 14).padding(.vertical, 10)
                                        .background(ClayBackground(style: .surface, radius: Radius.chip, elevation: 0.5))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Block \(profile.name)")
                            }
                        }
                        .sheet(isPresented: $showReport) {
                            ReportSheet(target: .user, targetID: uid, targetLabel: "this member",
                                        blockCandidate: (uid: uid, name: profile.name))
                        }
                        .confirmationDialog("Block \(profile.name)?", isPresented: $showBlockConfirm, titleVisibility: .visible) {
                            Button("Block", role: .destructive) {
                                Task { _ = await moderation.block(uid: uid, displayName: profile.name); Haptics.success(); dismiss() }
                            }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text("You won't see each other's posts, events or RSVPs.")
                        }
                    }

                    if posts.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: "bubble.left").foregroundStyle(Palette.inkFaint)
                            Text("No posts from this member yet.")
                                .font(VType.body(14)).foregroundStyle(Palette.inkSoft)
                            Spacer()
                        }
                        .padding(Spacing.md)
                        .background(ClayBackground(style: .inset, radius: Radius.md))
                    } else {
                        ForEach(posts) { post in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 4) {
                                    Image(systemName: "mappin").font(.system(size: 9, weight: .bold))
                                    Text(post.placeName).font(VType.body(12, .semibold))
                                    Spacer()
                                    Text(post.timeAgo).font(VType.body(11, .medium)).foregroundStyle(Palette.inkFaint)
                                }
                                .foregroundStyle(profile.accent.base)
                                Text(post.content).font(VType.body(14)).foregroundStyle(Palette.ink).lineSpacing(3)
                                HStack(spacing: 5) {
                                    Image(systemName: "heart.fill").font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(Palette.terracotta.base)
                                    Text("\(post.likeCount)").font(VType.num(12, .semibold)).foregroundStyle(Palette.inkSoft)
                                }
                            }
                            .padding(Spacing.md)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .claySurface(.surface, radius: Radius.md, elevation: 0.7)
                        }
                    }

                    Spacer(minLength: 0)
                }
                .padding(Spacing.lg)
                .padding(.bottom, Spacing.xl)
            }
            .background(VerdureBackground())
            .navigationTitle("Profile").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Palette.inkSoft)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.large])
    }
}
