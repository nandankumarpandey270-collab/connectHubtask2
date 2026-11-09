const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Database setup
const db = new Database('social_media.db');

db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    UNIQUE(post_id, user_id),
    FOREIGN KEY(post_id) REFERENCES posts(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    UNIQUE(follower_id, following_id),
    CHECK(follower_id != following_id),
    FOREIGN KEY(follower_id) REFERENCES users(id),
    FOREIGN KEY(following_id) REFERENCES users(id)
);
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'connecthub-development-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware
function auth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: 'Please login first'
        });
    }
    next();
}

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, username, email, password } = req.body;

        if (!name || !username || !email || !password) {
            return res.status(400).json({
                error: 'All fields are required'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters'
            });
        }

        const hash = await bcrypt.hash(password, 12);

        const result = db.prepare(`
            INSERT INTO users (name, username, email, password)
            VALUES (?, ?, ?, ?)
        `).run(
            name.trim(),
            username.trim().toLowerCase(),
            email.trim().toLowerCase(),
            hash
        );

        req.session.userId = result.lastInsertRowid;

        res.status(201).json({
            message: 'Account created successfully'
        });

    } catch (error) {
        res.status(400).json({
            error: 'Username or email already exists'
        });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = db.prepare(
            'SELECT * FROM users WHERE email = ?'
        ).get(email?.trim().toLowerCase());

        if (!user || !(await bcrypt.compare(password || '', user.password))) {
            return res.status(401).json({
                error: 'Invalid email or password'
            });
        }

        req.session.userId = user.id;

        res.json({
            message: 'Login successful'
        });

    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Current user
app.get('/api/me', auth, (req, res) => {
    const user = db.prepare(`
        SELECT id, name, username, email, bio
        FROM users WHERE id = ?
    `).get(req.session.userId);

    res.json(user);
});

// Logout
app.post('/api/logout', auth, (req, res) => {
    req.session.destroy(() => {
        res.json({ message: 'Logged out successfully' });
    });
});

// Get social media feed
app.get('/api/posts', (req, res) => {
    const posts = db.prepare(`
        SELECT posts.*, users.name, users.username,
        (SELECT COUNT(*) FROM likes WHERE post_id = posts.id) AS like_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comment_count
        FROM posts
        JOIN users ON users.id = posts.user_id
        ORDER BY posts.id DESC
    `).all();

    res.json(posts);
});

// Create post
app.post('/api/posts', auth, (req, res) => {
    const { content } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({
            error: 'Post cannot be empty'
        });
    }

    const result = db.prepare(`
        INSERT INTO posts (user_id, content)
        VALUES (?, ?)
    `).run(req.session.userId, content.trim());

    io.emit('new-post', { id: result.lastInsertRowid });

    res.status(201).json({
        message: 'Post created successfully'
    });
});

// Like / Unlike
app.post('/api/posts/:id/like', auth, (req, res) => {
    const postId = Number(req.params.id);

    const existing = db.prepare(`
        SELECT id FROM likes
        WHERE post_id = ? AND user_id = ?
    `).get(postId, req.session.userId);

    if (existing) {
        db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
        return res.json({ liked: false });
    }

    db.prepare(`
        INSERT INTO likes (post_id, user_id)
        VALUES (?, ?)
    `).run(postId, req.session.userId);

    res.json({ liked: true });
});

// Add comment
app.post('/api/posts/:id/comments', auth, (req, res) => {
    const { content } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({
            error: 'Comment cannot be empty'
        });
    }

    db.prepare(`
        INSERT INTO comments (post_id, user_id, content)
        VALUES (?, ?, ?)
    `).run(
        Number(req.params.id),
        req.session.userId,
        content.trim()
    );

    res.status(201).json({
        message: 'Comment added'
    });
});

// Get comments
app.get('/api/posts/:id/comments', (req, res) => {
    const comments = db.prepare(`
        SELECT comments.*, users.name, users.username
        FROM comments
        JOIN users ON users.id = comments.user_id
        WHERE post_id = ?
        ORDER BY comments.id ASC
    `).all(Number(req.params.id));

    res.json(comments);
});

// Follow / Unfollow
app.post('/api/users/:id/follow', auth, (req, res) => {
    const targetId = Number(req.params.id);
    const currentId = req.session.userId;

    if (targetId === currentId) {
        return res.status(400).json({
            error: 'You cannot follow yourself'
        });
    }

    const target = db.prepare(
        'SELECT id FROM users WHERE id = ?'
    ).get(targetId);

    if (!target) {
        return res.status(404).json({
            error: 'User not found'
        });
    }

    const existing = db.prepare(`
        SELECT id FROM follows
        WHERE follower_id = ? AND following_id = ?
    `).get(currentId, targetId);

    if (existing) {
        db.prepare('DELETE FROM follows WHERE id = ?')
            .run(existing.id);

        return res.json({ following: false });
    }

    db.prepare(`
        INSERT INTO follows (follower_id, following_id)
        VALUES (?, ?)
    `).run(currentId, targetId);

    res.json({ following: true });
});

// User search
app.get('/api/users', (req, res) => {
    const search = `%${req.query.q || ''}%`;

    const users = db.prepare(`
        SELECT id, name, username, bio
        FROM users
        WHERE name LIKE ? OR username LIKE ?
        LIMIT 30
    `).all(search, search);

    res.json(users);
});

// Profile statistics
app.get('/api/users/:id', (req, res) => {
    const user = db.prepare(`
        SELECT id, name, username, bio,
        (SELECT COUNT(*) FROM posts WHERE user_id = users.id) AS posts,
        (SELECT COUNT(*) FROM follows WHERE following_id = users.id) AS followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = users.id) AS following
        FROM users WHERE id = ?
    `).get(Number(req.params.id));

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
});

// Start server
server.listen(PORT, () => {
    console.log(`ConnectHub running at http://localhost:${PORT}`);
});