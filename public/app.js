const socket = io();

let currentUser = null;
let isRegister = false;

// API helper
async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: "same-origin",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
    }

    return data;
}

// HTML element helper
const $ = id => document.getElementById(id);

// Authentication switch
$("authSwitch").addEventListener("click", () => {
    isRegister = !isRegister;

    $("authTitle").textContent =
        isRegister ? "Create Account" : "Welcome Back";

    $("authDescription").textContent =
        isRegister ? "Join ConnectHub today." : "Login to continue your journey.";

    $("authSubmit").textContent =
        isRegister ? "Sign Up" : "Login";

    $("authSwitchText").textContent =
        isRegister ? "Already have an account?" : "Don't have an account?";

    $("authSwitch").textContent =
        isRegister ? "Login" : "Sign Up";

    $("authNameField").hidden = !isRegister;
    $("authUsernameField").hidden = !isRegister;

    $("authName").required = isRegister;
    $("authUsername").required = isRegister;

    $("authMessage").textContent = "";
});

// Register / Login
$("authForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = $("authSubmit");
    button.disabled = true;
    $("authMessage").textContent = "Please wait...";

    try {
        const payload = {
            email: $("authEmail").value.trim(),
            password: $("authPassword").value
        };

        if (isRegister) {
            payload.name = $("authName").value.trim();
            payload.username = $("authUsername").value.trim();
        }

        await api(
            isRegister ? "/api/register" : "/api/login",
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );

        $("authForm").reset();
        $("authMessage").textContent = "";

        await loadApp();

    } catch (error) {
        $("authMessage").textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

// Load application
async function loadApp() {
    try {
        currentUser = await api("/api/me");

        $("authSection").hidden = true;
        $("appSection").hidden = false;

        $("navUsername").textContent =
            "@" + currentUser.username;

        await loadProfile(currentUser.id);
        await loadPosts();
        await loadSuggestedUsers();

    } catch (error) {
        $("appSection").hidden = true;
        $("authSection").hidden = false;
    }
}

// Load profile
async function loadProfile(userId) {
    const user = await api(`/api/users/${userId}`);

    $("profileName").textContent = user.name;
    $("profileUsername").textContent = "@" + user.username;
    $("profileBio").textContent = user.bio || "Welcome to ConnectHub!";
    $("profileAvatar").textContent =
        user.name.charAt(0).toUpperCase();

    $("myPosts").textContent = user.posts;
    $("myFollowers").textContent = user.followers;
    $("myFollowing").textContent = user.following;
}

// Create element safely
function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;

    return element;
}

// Load posts
async function loadPosts() {
    const posts = await api("/api/posts");
    const container = $("postsContainer");

    container.replaceChildren();

    if (!posts.length) {
        container.append(
            createElement("p", "empty-feed", "No posts yet. Be the first to share something!")
        );
        return;
    }

    posts.forEach(post => {
        container.appendChild(createPostCard(post));
    });
}

// Create post card
function createPostCard(post) {
    const card = createElement("article", "post-card");

    const header = createElement("div", "post-header");

    const userInfo = createElement("div", "post-user");

    userInfo.append(
        createElement("strong", "", post.name),
        createElement("span", "", "@" + post.username)
    );

    header.append(userInfo);

    const content = createElement("p", "post-content", post.content);

    const stats = createElement("div", "post-stats");

    const likeCount = createElement(
        "span",
        "like-count",
        `${post.like_count} Likes`
    );

    const commentCount = createElement(
        "span",
        "comment-count",
        `${post.comment_count} Comments`
    );

    stats.append(likeCount, commentCount);

    const actions = createElement("div", "post-actions");

    const likeButton = createElement("button", "like-btn", "♥ Like");

    likeButton.addEventListener("click", async () => {
        if (!currentUser) return;

        try {
            const result = await api(
                `/api/posts/${post.id}/like`,
                { method: "POST" }
            );

            post.like_count += result.liked ? 1 : -1;

            likeCount.textContent = `${post.like_count} Likes`;

            likeButton.textContent =
                result.liked ? "♥ Liked" : "♥ Like";

        } catch (error) {
            alert(error.message);
        }
    });

    const commentButton = createElement(
        "button",
        "comment-btn",
        "Comment"
    );

    const commentSection = createElement(
        "div",
        "comments-section"
    );

    const commentList = createElement("div", "comment-list");

    const commentForm = createElement("form", "comment-form");

    const commentInput = createElement("input");
    commentInput.type = "text";
    commentInput.placeholder = "Write a comment...";
    commentInput.maxLength = 1000;
    commentInput.required = true;

    const commentSubmit = createElement(
        "button",
        "",
        "Send"
    );
    commentSubmit.type = "submit";

    commentForm.append(commentInput, commentSubmit);

    commentSection.append(commentList, commentForm);
    commentSection.hidden = true;

    commentButton.addEventListener("click", async () => {
        commentSection.hidden = !commentSection.hidden;

        if (!commentSection.hidden) {
            await loadComments(post.id, commentList);
        }
    });

    commentForm.addEventListener("submit", async event => {
        event.preventDefault();

        try {
            await api(`/api/posts/${post.id}/comments`, {
                method: "POST",
                body: JSON.stringify({
                    content: commentInput.value.trim()
                })
            });

            commentInput.value = "";

            post.comment_count++;

            commentCount.textContent =
                `${post.comment_count} Comments`;

            await loadComments(post.id, commentList);

        } catch (error) {
            alert(error.message);
        }
    });

    actions.append(likeButton, commentButton);

    card.append(header, content, stats, actions, commentSection);

    return card;
}

// Load comments
async function loadComments(postId, container) {
    try {
        const comments = await api(
            `/api/posts/${postId}/comments`
        );

        container.replaceChildren();

        if (!comments.length) {
            container.append(
                createElement("p", "", "No comments yet.")
            );
            return;
        }

        comments.forEach(comment => {
            const item = createElement("div", "comment-item");

            item.append(
                createElement(
                    "strong",
                    "",
                    comment.name + " @" + comment.username
                ),
                createElement("p", "", comment.content)
            );

            container.append(item);
        });

    } catch (error) {
        container.textContent = error.message;
    }
}

// Publish post
$("publishBtn").addEventListener("click", async () => {
    const content = $("postContent").value.trim();

    if (!content) {
        $("message").textContent = "Please write something first.";
        return;
    }

    const button = $("publishBtn");
    button.disabled = true;

    try {
        await api("/api/posts", {
            method: "POST",
            body: JSON.stringify({ content })
        });

        $("postContent").value = "";
        $("message").textContent = "Post published successfully!";

        await loadPosts();
        await loadProfile(currentUser.id);

    } catch (error) {
        $("message").textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

// Discover users
async function loadSuggestedUsers(query = "") {
    try {
        const users = await api(
            `/api/users?q=${encodeURIComponent(query)}`
        );

        const container = $("suggestedUsers");
        container.replaceChildren();

        const otherUsers = users.filter(
            user => user.id !== currentUser.id
        );

        if (!otherUsers.length) {
            container.append(
                createElement("p", "", "No users found.")
            );
            return;
        }

        otherUsers.forEach(user => {
            const item = createElement("div", "suggested-user");

            const info = createElement("div", "suggested-info");

            info.append(
                createElement("strong", "", user.name),
                createElement("span", "", "@" + user.username)
            );

            const followButton = createElement(
                "button",
                "follow-btn",
                "Follow"
            );

            followButton.addEventListener("click", async () => {
                followButton.disabled = true;

                try {
                    const result = await api(
                        `/api/users/${user.id}/follow`,
                        { method: "POST" }
                    );

                    followButton.textContent =
                        result.following ? "Following" : "Follow";

                    await loadProfile(currentUser.id);

                } catch (error) {
                    alert(error.message);
                } finally {
                    followButton.disabled = false;
                }
            });

            item.append(info, followButton);
            container.append(item);
        });

    } catch (error) {
        console.error("User loading failed:", error);
    }
}

// Search users
let searchTimeout;

$("userSearch").addEventListener("input", () => {
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(() => {
        loadSuggestedUsers($("userSearch").value.trim());
    }, 300);
});

// Logout
$("logoutBtn").addEventListener("click", async () => {
    try {
        await api("/api/logout", { method: "POST" });

        currentUser = null;

        $("appSection").hidden = true;
        $("authSection").hidden = false;

        $("authMessage").textContent = "";
        $("authForm").reset();

        isRegister = false;
        $("authTitle").textContent = "Welcome Back";
        $("authSubmit").textContent = "Login";
        $("authSwitchText").textContent = "Don't have an account?";
        $("authSwitch").textContent = "Sign Up";
        $("authNameField").hidden = true;
        $("authUsernameField").hidden = true;

    } catch (error) {
        alert(error.message);
    }
});

// Real-time new post updates
socket.on("new-post", async () => {
    if (currentUser) {
        await loadPosts();
    }
});

// Initial session check
loadApp();