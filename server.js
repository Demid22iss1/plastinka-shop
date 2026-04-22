// @ts-nocheck
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const app = express();
const db = new sqlite3.Database("./database.sqlite");
db.run("PRAGMA encoding = 'UTF-8'");
db.run("PRAGMA case_sensitive_like = OFF");

// ============================================================
// НАСТРОЙКИ MIDDLEWARE
// ============================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: "plastinka-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================
// СОЗДАНИЕ ПАПОК ДЛЯ ЗАГРУЗКИ ФАЙЛОВ
// ============================================================
const uploadDirs = ['public/uploads', 'public/audio', 'public/photo', 'public/avatars'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Создана папка: ${dir}`);
    }
});

// ============================================================
// НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ФАЙЛОВ
// ============================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === "image" || file.fieldname === "product_image") cb(null, "public/uploads/");
        else if (file.fieldname === "player_image") cb(null, "public/photo/");
        else if (file.fieldname === "avatar") cb(null, "public/avatars/");
        else cb(null, "public/audio/");
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ============================================================
// MIDDLEWARE ДЛЯ ЗАЩИТЫ МАРШРУТОВ
// ============================================================
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Требуется авторизация' });
        return res.redirect("/login");
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "admin") {
        return res.status(403).send('Доступ запрещен');
    }
    next();
};

app.use((req, res, next) => {
    req.isMobile = /mobile|android|iphone|ipad|phone/i.test(req.headers['user-agent'] || '');
    next();
});

// ============================================================
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
// ============================================================
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        artist TEXT,
        price REAL,
        image TEXT,
        audio TEXT,
        description TEXT,
        genre TEXT,
        year TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price REAL,
        image TEXT,
        description TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        avatar TEXT DEFAULT 'default-avatar.png',
        telegram_id INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS carts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_id TEXT,
        quantity INTEGER DEFAULT 1,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, product_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_id TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, product_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_id INTEGER,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        comment TEXT,
        admin_reply TEXT,
        admin_reply_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        UNIQUE(user_id, product_id)
    )`);

    db.get("SELECT COUNT(*) as count FROM site_settings WHERE key = 'homepage_products'", [], (err, result) => {
        if (!err && result.count === 0) {
            db.run("INSERT INTO site_settings (key, value) VALUES (?, ?)", ['homepage_products', 'last_added']);
        }
    });

    db.get("SELECT COUNT(*) as count FROM players", [], (err, result) => {
        if (!err && result.count === 0) {
            const players = [
                ['Pro-Ject Debut Carbon', 499, 'proigrvatel1.png', 'Высококачественный проигрыватель винила'],
                ['Audio-Technica AT-LP120', 299, 'proigrvatel2.png', 'Профессиональный проигрыватель'],
                ['Rega Planar 3', 899, 'proigrvatel3.png', 'Легендарный британский проигрыватель']
            ];
            const stmt = db.prepare("INSERT INTO players (name, price, image, description) VALUES (?, ?, ?, ?)");
            players.forEach(p => stmt.run(p));
            stmt.finalize();
        }
    });

    db.get("SELECT COUNT(*) as count FROM products", [], (err, result) => {
        if (!err && result.count === 0) {
            const products = [
                ['Dark Side of the Moon', 'Pink Floyd', 35, 'dark-side.png', 'dark-side.mp3', 'Легендарный альбом', 'Rock', '1973'],
                ['Abbey Road', 'The Beatles', 40, 'abbey-road.png', 'abbey-road.mp3', 'Последний записанный альбом', 'Rock', '1969'],
                ['Thriller', 'Michael Jackson', 45, 'thriller.png', 'thriller.mp3', 'Самый продаваемый альбом', 'Pop', '1982']
            ];
            const stmt = db.prepare("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            products.forEach(p => stmt.run(p));
            stmt.finalize();
        }
    });

    db.get("SELECT COUNT(*) as count FROM users", [], (err, result) => {
        if (!err && result.count === 0) {
            const hash = bcrypt.hashSync("admin123", 10);
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ["admin", hash, "admin"]);
        }
    });
});

// ============================================================
// TELEGRAM АВТОРИЗАЦИЯ
// ============================================================
app.post("/api/telegram-auth", express.json(), (req, res) => {
    const { id, first_name, last_name, username, photo_url } = req.body;
    
    if (!id) {
        return res.json({ success: false, error: "No telegram id" });
    }
    
    db.get("SELECT * FROM users WHERE telegram_id = ?", [id], (err, user) => {
        if (err) {
            return res.json({ success: false, error: err.message });
        }
        
        if (user) {
            req.session.user = { 
                id: user.id, 
                username: user.username, 
                role: user.role, 
                avatar: user.avatar,
                telegram_id: id
            };
            res.json({ success: true, isNew: false });
        } else {
            const newUsername = username || `tg_user_${id}`;
            const defaultPassword = Math.random().toString(36).substring(2, 15);
            const hash = bcrypt.hashSync(defaultPassword, 10);
            
            db.run(
                "INSERT INTO users (username, password, role, telegram_id, avatar) VALUES (?, ?, 'user', ?, ?)",
                [newUsername, hash, id, 'default-avatar.png'],
                function(err) {
                    if (err) {
                        return res.json({ success: false, error: err.message });
                    }
                    
                    req.session.user = { 
                        id: this.lastID, 
                        username: newUsername, 
                        role: 'user', 
                        avatar: 'default-avatar.png',
                        telegram_id: id
                    };
                    res.json({ success: true, isNew: true });
                }
            );
        }
    });
});

// ============================================================
// API ДЛЯ АВАТАРКИ
// ============================================================
app.post("/api/upload-avatar", requireAuth, upload.single("avatar"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Файл не загружен" });
    }
    db.run("UPDATE users SET avatar = ? WHERE id = ?", [req.file.filename, req.session.user.id], (err) => {
        if (err) {
            return res.status(500).json({ error: "Ошибка сохранения аватара" });
        }
        req.session.user.avatar = req.file.filename;
        res.json({ success: true, avatar: `/avatars/${req.file.filename}` });
    });
});

// ============================================================
// API ДЛЯ ИЗБРАННОГО
// ============================================================
app.get("/api/favorites/status/:productId", requireAuth, (req, res) => {
    const productId = req.params.productId;
    const userId = req.session.user.id;
    
    db.get("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?", [userId, productId], (err, fav) => {
        res.json({ isFavorite: !!fav });
    });
});

app.get("/api/favorites/count", requireAuth, (req, res) => {
    db.get("SELECT COUNT(*) as count FROM favorites WHERE user_id = ?", [req.session.user.id], (err, result) => {
        res.json({ count: result?.count || 0 });
    });
});

app.get("/api/favorites/list", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    
    db.all(`SELECT f.*, p.name, p.artist, p.price, p.image, p.id as product_db_id
            FROM favorites f
            JOIN products p ON f.product_id = 'product_' || p.id
            WHERE f.user_id = ?
            ORDER BY f.added_at DESC`, [userId], (err, products) => {
        
        db.all(`SELECT f.*, p.name, p.price, p.image, p.id as player_db_id
                FROM favorites f
                JOIN players p ON f.product_id = 'player_' || p.id
                WHERE f.user_id = ?
                ORDER BY f.added_at DESC`, [userId], (err2, players) => {
            
            const allFavorites = [];
            if (products) {
                products.forEach(p => {
                    allFavorites.push({
                        id: p.product_db_id,
                        type: 'product',
                        name: p.name,
                        artist: p.artist,
                        price: p.price,
                        image: p.image,
                        added_at: p.added_at
                    });
                });
            }
            if (players) {
                players.forEach(p => {
                    allFavorites.push({
                        id: p.player_db_id,
                        type: 'player',
                        name: p.name,
                        artist: 'Проигрыватель',
                        price: p.price,
                        image: p.image,
                        added_at: p.added_at
                    });
                });
            }
            allFavorites.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
            res.json({ success: true, favorites: allFavorites });
        });
    });
});

app.post("/api/favorites/toggle", requireAuth, express.json(), (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    
    db.get("SELECT * FROM favorites WHERE user_id = ? AND product_id = ?", [userId, id], (err, fav) => {
        if (fav) {
            db.run("DELETE FROM favorites WHERE user_id = ? AND product_id = ?", [userId, id], function(err) {
                res.json({ success: true, action: "removed" });
            });
        } else {
            db.run("INSERT INTO favorites (user_id, product_id) VALUES (?, ?)", [userId, id], function(err) {
                res.json({ success: true, action: "added" });
            });
        }
    });
});

app.post("/api/favorites/remove", requireAuth, express.json(), (req, res) => {
    const { productId, type } = req.body;
    const userId = req.session.user.id;
    const fullProductId = type === 'product' ? `product_${productId}` : `player_${productId}`;
    
    db.run("DELETE FROM favorites WHERE user_id = ? AND product_id = ?", [userId, fullProductId], function(err) {
        res.json({ success: true });
    });
});

// ============================================================
// API ДЛЯ КОРЗИНЫ
// ============================================================
app.post("/api/cart/add", requireAuth, express.json(), (req, res) => {
    const { id } = req.body;
    const userId = req.session.user.id;
    
    db.get("SELECT * FROM carts WHERE user_id = ? AND product_id = ?", [userId, id], (err, existing) => {
        if (existing) {
            db.run("UPDATE carts SET quantity = quantity + 1 WHERE user_id = ? AND product_id = ?", [userId, id], (err) => {
                res.json({ success: true });
            });
        } else {
            db.run("INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)", [userId, id], (err) => {
                res.json({ success: true });
            });
        }
    });
});

app.post("/api/cart/update", requireAuth, express.json(), (req, res) => {
    const { product_id, action } = req.body;
    const userId = req.session.user.id;
    
    db.get("SELECT * FROM carts WHERE user_id = ? AND product_id = ?", [userId, product_id], (err, cartItem) => {
        if (!cartItem) return res.json({ success: false });
        
        let newQuantity = cartItem.quantity;
        if (action === 'increase') newQuantity++;
        else if (action === 'decrease') newQuantity--;
        
        if (newQuantity <= 0) {
            db.run("DELETE FROM carts WHERE user_id = ? AND product_id = ?", [userId, product_id], (err) => {
                res.json({ success: true });
            });
        } else {
            db.run("UPDATE carts SET quantity = ? WHERE user_id = ? AND product_id = ?", [newQuantity, userId, product_id], (err) => {
                res.json({ success: true });
            });
        }
    });
});

app.post("/api/cart/remove", requireAuth, express.json(), (req, res) => {
    const { product_id } = req.body;
    const userId = req.session.user.id;
    
    db.run("DELETE FROM carts WHERE user_id = ? AND product_id = ?", [userId, product_id], (err) => {
        res.json({ success: true });
    });
});

// ============================================================
// API ДЛЯ РЕЙТИНГА
// ============================================================
app.get("/api/rating/:productId", (req, res) => {
    const productId = req.params.productId;
    
    db.get(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`, [productId], (err, result) => {
        db.all(`SELECT r.rating, r.comment, r.created_at, u.username, r.admin_reply
                FROM ratings r
                JOIN users u ON r.user_id = u.id
                WHERE r.product_id = ? AND r.comment IS NOT NULL AND r.comment != ''
                ORDER BY r.created_at DESC LIMIT 10`, [productId], (err2, comments) => {
            res.json({
                avg_rating: result?.avg_rating ? parseFloat(result.avg_rating).toFixed(1) : 0,
                votes_count: result?.votes_count || 0,
                comments: comments || []
            });
        });
    });
});

app.post("/api/rating/:productId", requireAuth, express.json(), (req, res) => {
    const productId = req.params.productId;
    const userId = req.session.user.id;
    const { rating, comment } = req.body;
    
    db.run(`INSERT INTO ratings (user_id, product_id, rating, comment, updated_at) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, product_id) 
            DO UPDATE SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP`,
        [userId, productId, rating, comment || null, rating, comment || null],
        function(err) {
            db.get(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`, [productId], (err, result) => {
                db.all(`SELECT r.rating, r.comment, r.created_at, u.username, r.admin_reply
                        FROM ratings r
                        JOIN users u ON r.user_id = u.id
                        WHERE r.product_id = ? AND r.comment IS NOT NULL AND r.comment != ''
                        ORDER BY r.created_at DESC LIMIT 10`, [productId], (err2, comments) => {
                    res.json({
                        success: true,
                        avg_rating: result?.avg_rating ? parseFloat(result.avg_rating).toFixed(1) : 0,
                        votes_count: result?.votes_count || 0,
                        comments: comments || []
                    });
                });
            });
        });
});

// ============================================================
// API ДЛЯ ПОИСКА
// ============================================================
app.get("/api/search", (req, res) => {
    const query = req.query.q || '';
    
    if (query.length < 1) {
        return res.json({ results: [] });
    }
    
    const searchPattern = `%${query}%`;
    
    db.all(`SELECT id, name, artist, price, image, audio, description, genre, year, 'product' as type 
            FROM products 
            WHERE name LIKE ? OR artist LIKE ? 
            LIMIT 10`, [searchPattern, searchPattern], (err, products) => {
        
        db.all(`SELECT id, name, 'Проигрыватель' as artist, price, image, description, 'player' as type 
                FROM players 
                WHERE name LIKE ? 
                LIMIT 5`, [searchPattern], (err2, players) => {
            
            const results = [...(products || []), ...(players || [])];
            res.json({ results: results });
        });
    });
});

// ============================================================
// ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
// ============================================================
app.get("/profile", requireAuth, (req, res) => {
    const user = req.session.user;
    
    db.get("SELECT avatar FROM users WHERE id = ?", [user.id], (err, userData) => {
        const avatar = userData ? userData.avatar : 'default-avatar.png';
        
        const content = `
            <div class="profile-header">
                <div class="avatar-container" onclick="openAvatarModal()">
                    <img src="/avatars/${avatar}" class="profile-avatar" id="profileAvatar">
                    <div class="avatar-overlay"><i class="fas fa-camera"></i></div>
                </div>
                <h2 class="profile-name">${escapeHtml(user.username)}</h2>
                <p class="profile-role">${user.role === 'admin' ? 'Администратор' : 'Покупатель'}</p>
            </div>
            <div class="profile-stats">
                <div class="stat"><div class="stat-value" id="favCount">0</div><div class="stat-label">Избранное</div></div>
            </div>
            <div class="profile-menu">
                <div class="menu-item" onclick="openSettingsModal()"><i class="fas fa-user-edit"></i><span>Настройки аккаунта</span><i class="fas fa-chevron-right arrow"></i></div>
                <div class="menu-item" onclick="openFavoritesModal()"><i class="fas fa-heart"></i><span>Избранное</span><i class="fas fa-chevron-right arrow"></i></div>
            </div>
            ${user.role === 'admin' ? '<a href="/admin" class="admin-panel-btn"><i class="fas fa-crown"></i> Админ панель</a>' : ''}
            <a href="/logout" class="logout-btn">Выйти</a>
            
            <div id="avatarModal" class="modal-overlay" style="display:none;">
                <div class="modal-content" style="max-width:400px; text-align:center;">
                    <button class="modal-close" onclick="closeAvatarModal()">&times;</button>
                    <h3 style="color:#ff7a2f; margin-bottom:20px;">📸 Изменить аватар</h3>
                    <div style="width:150px; height:150px; margin:0 auto; overflow:hidden; border-radius:50%; border:3px solid #ff7a2f;">
                        <img src="/avatars/${avatar}" id="avatarPreview" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <input type="file" id="avatarFileInput" accept="image/*" style="display:none;" onchange="uploadAvatar()">
                    <button type="button" onclick="document.getElementById('avatarFileInput').click()" style="background:rgba(255,122,47,0.2); border:1px solid #ff7a2f; color:#ff7a2f; padding:10px 20px; border-radius:8px; cursor:pointer; width:100%; margin:15px 0;">📁 Выбрать изображение</button>
                    <p id="avatarUploadMessage" style="margin-top:10px; font-size:12px;"></p>
                </div>
            </div>
            
            <div id="settingsModal" class="modal-overlay" style="display:none;">
                <div class="modal-content" style="max-width:350px;">
                    <button class="modal-close" onclick="closeSettingsModal()">&times;</button>
                    <h3 style="color:#ff7a2f; margin-bottom:20px;">⚙️ Настройки аккаунта</h3>
                    <form id="settingsForm">
                        <div class="form-group" style="margin-bottom:15px;">
                            <label style="color:#aaa; display:block; margin-bottom:5px;">Имя пользователя</label>
                            <input type="text" id="settingsUsername" value="${escapeHtml(user.username)}" style="width:100%; padding:10px; background:#111; border:1px solid #333; color:#fff; border-radius:8px;">
                        </div>
                        <div class="form-group" style="margin-bottom:15px;">
                            <label style="color:#aaa; display:block; margin-bottom:5px;">Текущий пароль</label>
                            <input type="password" id="settingsCurrentPassword" placeholder="Для смены пароля" style="width:100%; padding:10px; background:#111; border:1px solid #333; color:#fff; border-radius:8px;">
                        </div>
                        <div class="form-group" style="margin-bottom:15px;">
                            <label style="color:#aaa; display:block; margin-bottom:5px;">Новый пароль</label>
                            <input type="password" id="settingsNewPassword" placeholder="Новый пароль" style="width:100%; padding:10px; background:#111; border:1px solid #333; color:#fff; border-radius:8px;">
                        </div>
                        <button type="submit" style="width:100%; padding:12px; background:linear-gradient(45deg,#ff0000,#990000); border:none; border-radius:8px; color:white; font-weight:bold; cursor:pointer;">Сохранить изменения</button>
                    </form>
                    <p id="settingsMessage" style="margin-top:15px; text-align:center; font-size:12px;"></p>
                </div>
            </div>
            
            <div id="favoritesModal" class="modal-overlay" style="display:none;">
                <div class="modal-content" style="max-width:600px; max-height:80vh; overflow-y:auto;">
                    <button class="modal-close" onclick="closeFavoritesModal()">&times;</button>
                    <h3 style="color:#ff7a2f; margin-bottom:20px; text-align:center;"><i class="fas fa-heart"></i> Моё избранное</h3>
                    <div id="favoritesList" style="display:flex; flex-direction:column; gap:15px;"><div style="text-align:center; padding:40px; color:#666;">Загрузка...</div></div>
                </div>
            </div>
        `;
        
        res.send(renderMobilePage('Профиль', content, user, 'profile'));
    });
});

app.post("/api/update-profile", requireAuth, express.json(), (req, res) => {
    const { username, currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;
    
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (username && username !== user.username) {
            db.get("SELECT id FROM users WHERE username = ? AND id != ?", [username, userId], (err, existing) => {
                if (existing) return res.json({ success: false, error: "Имя пользователя уже занято" });
                updateUser();
            });
        } else {
            updateUser();
        }
        
        function updateUser() {
            if (currentPassword && newPassword) {
                if (bcrypt.compareSync(currentPassword, user.password)) {
                    const hashedPassword = bcrypt.hashSync(newPassword, 10);
                    db.run("UPDATE users SET username = ?, password = ? WHERE id = ?", [username || user.username, hashedPassword, userId], function(err) {
                        if (err) return res.json({ success: false, error: "Ошибка обновления" });
                        req.session.user.username = username || user.username;
                        res.json({ success: true, username: req.session.user.username });
                    });
                } else {
                    res.json({ success: false, error: "Неверный текущий пароль" });
                }
            } else {
                db.run("UPDATE users SET username = ? WHERE id = ?", [username || user.username, userId], function(err) {
                    if (err) return res.json({ success: false, error: "Ошибка обновления" });
                    req.session.user.username = username || user.username;
                    res.json({ success: true, username: req.session.user.username });
                });
            }
        }
    });
});

// ============================================================
// ГЛАВНАЯ СТРАНИЦА
// ============================================================
app.get("/", (req, res) => {
    const user = req.session.user;
    
    db.all("SELECT * FROM products ORDER BY id DESC LIMIT 6", [], (err, products) => {
        if (err) products = [];
        
        const productPromises = products.map(product => {
            return new Promise((resolve) => {
                db.get(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`, [product.id], (err, rating) => {
                    product.avg_rating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
                    product.votes_count = rating?.votes_count || 0;
                    resolve();
                });
            });
        });
        
        Promise.all(productPromises).then(() => {
            let productsHTML = "";
            products.forEach(product => {
                productsHTML += `
                    <div class="product-card" data-product-id="${product.id}" data-product-name="${escapeHtml(product.name)}" data-product-artist="${escapeHtml(product.artist)}" data-product-price="${product.price}" data-product-image="/uploads/${product.image}" data-product-description="${escapeHtml(product.description || 'Нет описания')}" data-product-genre="${escapeHtml(product.genre || 'Rock')}" data-product-year="${escapeHtml(product.year || '1970')}" data-product-audio="${product.audio || ''}" data-audio-url="${product.audio ? '/audio/' + product.audio : ''}" onclick="showProductModal(${product.id}, '${escapeHtml(product.name)}', '${escapeHtml(product.artist)}', ${product.price}, '/uploads/${product.image}', '${escapeHtml(product.description || 'Нет описания')}', '${escapeHtml(product.genre || 'Rock')}', '${escapeHtml(product.year || '1970')}', '${product.audio || ''}')">
                        <div class="product-image">
                            <img src="/uploads/${product.image}" alt="${escapeHtml(product.name)}">
                            <div class="vinyl-overlay">
                                <img src="/photo/plastinka-audio.png" class="vinyl-icon">
                            </div>
                        </div>
                        <div class="product-info">
                            <div class="product-name">${escapeHtml(product.name)}</div>
                            <div class="product-artist">${escapeHtml(product.artist)}</div>
                            <div class="rating-stars" data-product-id="${product.id}">
                                ${generateStarRatingHTML(product.avg_rating, product.votes_count)}
                            </div>
                            <div class="product-price">$${product.price}</div>
                            <div class="product-actions">
                                <button class="action-btn" onclick="event.stopPropagation(); addToCartMobile('product_${product.id}')"><i class="fas fa-shopping-cart"></i></button>
                                <button class="action-btn" onclick="event.stopPropagation(); toggleFavoriteMobile('product_${product.id}')"><i class="fas fa-heart"></i></button>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            const content = `
                <h2 class="section-title">Новинки</h2>
                <div class="products-grid">${productsHTML || '<p style="text-align:center; color:#aaa;">Товаров пока нет</p>'}</div>
                ${!user ? '<div class="auth-prompt"><p>Войдите, чтобы добавлять товары в избранное и корзину</p><a href="/login" class="auth-btn">Войти</a></div>' : ''}
                
                <div id="productModal" class="modal-overlay" style="display:none;">
                    <div class="modal-content">
                        <button class="modal-close" onclick="closeProductModal()">&times;</button>
                        <img src="" alt="Пластинка" class="modal-player-image" id="productModalImage">
                        <h2 class="modal-title" id="productModalTitle"></h2>
                        <p class="modal-artist" id="productModalArtist"></p>
                        <div class="modal-tags" id="productModalTags"></div>
                        <div class="rating-section">
                            <div class="rating-label">Средняя оценка:</div>
                            <div class="rating-stars-large" id="modalRatingStars"></div>
                            <div class="rating-votes" id="modalRatingVotes"></div>
                        </div>
                        <div class="comments-list" id="modalCommentsList"></div>
                        <p class="modal-description" id="productModalDescription"></p>
                        <div class="modal-price" id="productModalPrice"></div>
                        <div class="modal-actions">
                            <button onclick="addToCartFromModal()" class="modal-add-to-cart">В корзину</button>
                            <button onclick="toggleFavoriteFromModal()" class="modal-fav-btn"><i class="fas fa-heart"></i></button>
                        </div>
                        <button onclick="openReviewModal()" class="modal-review-btn">✍️ Оставить отзыв</button>
                        <div id="productModalAudio" style="display:none;"></div>
                        <button onclick="playModalPreview()" class="modal-play-btn" id="productModalPlayBtn" style="display:none;"><i class="fas fa-play"></i> Прослушать</button>
                    </div>
                </div>
                
                <div id="reviewModal" class="modal-overlay" style="display:none;">
                    <div class="modal-content">
                        <button class="modal-close" onclick="closeReviewModal()">&times;</button>
                        <h3 style="color:#ff7a2f; margin-bottom:20px;">⭐ Оцените пластинку</h3>
                        <div class="review-stars" id="reviewStars" style="display:flex; gap:10px; justify-content:center; margin-bottom:20px;">
                            <i class="far fa-star" data-rating="1" style="font-size:30px; cursor:pointer;"></i>
                            <i class="far fa-star" data-rating="2" style="font-size:30px; cursor:pointer;"></i>
                            <i class="far fa-star" data-rating="3" style="font-size:30px; cursor:pointer;"></i>
                            <i class="far fa-star" data-rating="4" style="font-size:30px; cursor:pointer;"></i>
                            <i class="far fa-star" data-rating="5" style="font-size:30px; cursor:pointer;"></i>
                        </div>
                        <textarea id="reviewComment" placeholder="Напишите ваш отзыв (необязательно)..." rows="4" style="width:100%; background:#111; border:1px solid #333; color:white; border-radius:8px; padding:10px; margin-bottom:15px;"></textarea>
                        <button onclick="submitReview()" class="submit-review-btn" style="width:100%; padding:12px; background:linear-gradient(45deg,#ff7a2f,#ff0000); border:none; border-radius:8px; color:white; font-weight:bold; cursor:pointer;">Отправить отзыв</button>
                    </div>
                </div>
            `;
            
            res.send(renderMobilePage('Главная', content, user, 'home'));
        });
    });
});

// ============================================================
// КАТАЛОГ
// ============================================================
app.get("/catalog", (req, res) => {
    const user = req.session.user;
    const { search } = req.query;
    
    let sql = "SELECT * FROM products WHERE 1=1";
    let params = [];
    
    if (search && search.trim()) {
        sql += " AND (name LIKE ? OR artist LIKE ?)";
        const searchTerm = `%${search.trim()}%`;
        params.push(searchTerm, searchTerm);
    }
    sql += " ORDER BY id DESC";
    
    db.all(sql, params, (err, products) => {
        if (err) products = [];
        
        const productPromises = products.map(product => {
            return new Promise((resolve) => {
                db.get(`SELECT AVG(rating) as avg_rating, COUNT(*) as votes_count FROM ratings WHERE product_id = ?`, [product.id], (err, rating) => {
                    product.avg_rating = rating?.avg_rating ? parseFloat(rating.avg_rating).toFixed(1) : 0;
                    product.votes_count = rating?.votes_count || 0;
                    resolve();
                });
            });
        });
        
        Promise.all(productPromises).then(() => {
            let productsHTML = "";
            products.forEach(product => {
                productsHTML += `
                    <div class="product-card" data-product-id="${product.id}" data-product-name="${escapeHtml(product.name)}" data-product-artist="${escapeHtml(product.artist)}" data-product-price="${product.price}" data-product-image="/uploads/${product.image}" data-product-description="${escapeHtml(product.description || 'Нет описания')}" data-product-genre="${escapeHtml(product.genre || 'Rock')}" data-product-year="${escapeHtml(product.year || '1970')}" data-product-audio="${product.audio || ''}" data-audio-url="${product.audio ? '/audio/' + product.audio : ''}" onclick="showProductModal(${product.id}, '${escapeHtml(product.name)}', '${escapeHtml(product.artist)}', ${product.price}, '/uploads/${product.image}', '${escapeHtml(product.description || 'Нет описания')}', '${escapeHtml(product.genre || 'Rock')}', '${escapeHtml(product.year || '1970')}', '${product.audio || ''}')">
                        <div class="product-image">
                            <img src="/uploads/${product.image}" alt="${escapeHtml(product.name)}">
                            <div class="vinyl-overlay">
                                <img src="/photo/plastinka-audio.png" class="vinyl-icon">
                            </div>
                        </div>
                        <div class="product-info">
                            <div class="product-name">${escapeHtml(product.name)}</div>
                            <div class="product-artist">${escapeHtml(product.artist)}</div>
                            <div class="rating-stars" data-product-id="${product.id}">
                                ${generateStarRatingHTML(product.avg_rating, product.votes_count)}
                            </div>
                            <div class="product-price">$${product.price}</div>
                            <div class="product-actions">
                                <button class="action-btn" onclick="event.stopPropagation(); addToCartMobile('product_${product.id}')"><i class="fas fa-shopping-cart"></i></button>
                                <button class="action-btn" onclick="event.stopPropagation(); toggleFavoriteMobile('product_${product.id}')"><i class="fas fa-heart"></i></button>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            const searchHtml = `
                <div class="big-search" style="margin-bottom:20px;">
                    <form method="GET" action="/catalog" style="display:flex; gap:10px;">
                        <input type="text" name="search" placeholder="Найти пластинку..." value="${escapeHtml(search || '')}" style="flex:1; background:#1a1a1a; border:1px solid #333; border-radius:40px; padding:12px 20px; color:white; outline:none;">
                        <button type="submit" style="background:linear-gradient(45deg,#ff0000,#990000); border:none; border-radius:40px; padding:0 24px; color:white; font-weight:bold; cursor:pointer;">Поиск</button>
                    </form>
                </div>
            `;
            
            const content = searchHtml + `<h2 class="section-title">Все пластинки (${products.length})</h2><div class="products-grid">${productsHTML || '<div class="empty-state"><div class="empty-icon">🎵</div><h3>Ничего не найдено</h3><p>Попробуйте изменить поисковый запрос</p><a href="/catalog" class="empty-btn">Сбросить фильтр</a></div>'}</div>`;
            
            res.send(renderMobilePage('Каталог', content, user, 'catalog'));
        });
    });
});

// ============================================================
// ИЗБРАННОЕ
// ============================================================
app.get("/favorites", requireAuth, (req, res) => {
    const user = req.session.user;
    
    const content = `
        <h2 class="section-title">Избранное</h2>
        <div id="favoritesGrid" class="products-grid" style="min-height:200px;">
            <div style="text-align:center; padding:40px; color:#666;"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>
        </div>
        <script>
        async function loadFavoritesPage() {
            const container = document.getElementById('favoritesGrid');
            try {
                const response = await fetch('/api/favorites/list');
                const data = await response.json();
                
                if (!data.success || data.favorites.length === 0) {
                    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fas fa-heart-broken"></i></div><h3>Избранное пусто</h3><p>Добавляйте пластинки в избранное, чтобы не потерять их</p><a href="/catalog" class="empty-btn">Перейти в каталог →</a></div>';
                    return;
                }
                
                let html = '';
                for (let item of data.favorites) {
                    const imagePath = item.type === 'product' ? '/uploads/' + item.image : '/photo/' + item.image;
                    html += '<div class="product-card" data-product-id="' + item.id + '" data-type="' + item.type + '">' +
                        '<div class="product-image"><img src="' + imagePath + '" onerror="this.src=\\'/photo/plastinka-audio.png\\'"></div>' +
                        '<div class="product-info">' +
                        '<div class="product-name">' + escapeHtml(item.name) + '</div>' +
                        '<div class="product-artist">' + escapeHtml(item.artist) + '</div>' +
                        '<div class="product-price">$' + item.price + '</div>' +
                        '<div class="product-actions">' +
                        '<button class="action-btn" onclick="addToCartMobile(\\'' + (item.type === 'product' ? 'product_' : 'player_') + item.id + '\\')"><i class="fas fa-shopping-cart"></i></button>' +
                        '<button class="action-btn" onclick="removeFromFavorites(' + item.id + ', \\'' + item.type + '\\')"><i class="fas fa-trash"></i></button>' +
                        '</div></div></div>';
                }
                container.innerHTML = html;
            } catch (error) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><h3>Ошибка загрузки</h3><p>Попробуйте позже</p></div>';
            }
        }
        
        async function removeFromFavorites(productId, type) {
            try {
                const response = await fetch('/api/favorites/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ productId: productId, type: type })
                });
                const data = await response.json();
                if (data.success) {
                    showToastMobile('Удалено из избранного', false);
                    loadFavoritesPage();
                }
            } catch (error) {
                showToastMobile('Ошибка удаления', true);
            }
        }
        
        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        
        loadFavoritesPage();
        </script>
    `;
    
    res.send(renderMobilePage('Избранное', content, user, 'favorites'));
});

// ============================================================
// КОРЗИНА
// ============================================================
app.get("/cart", requireAuth, (req, res) => {
    const user = req.session.user;
    
    const content = `
        <h2 class="section-title">Корзина</h2>
        <div id="cartItems" style="margin-bottom:20px;">
            <div style="text-align:center; padding:40px; color:#666;"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>
        </div>
        <div id="cartTotal" style="display:none;"></div>
        <script>
        let cartItems = [];
        
        async function loadCart() {
            const container = document.getElementById('cartItems');
            try {
                const response = await fetch('/api/cart/list');
                const data = await response.json();
                cartItems = data.items || [];
                
                if (cartItems.length === 0) {
                    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🛒</div><h3>Корзина пуста</h3><p>Добавьте понравившиеся пластинки</p><a href="/catalog" class="empty-btn">Перейти в каталог →</a></div>';
                    document.getElementById('cartTotal').style.display = 'none';
                    return;
                }
                
                let html = '';
                let total = 0;
                for (let item of cartItems) {
                    const imagePath = item.type === 'product' ? '/uploads/' + item.image : '/photo/' + item.image;
                    const subtotal = item.price * item.quantity;
                    total += subtotal;
                    html += '<div class="cart-item" data-id="' + item.product_id + '">' +
                        '<img src="' + imagePath + '" class="cart-item-image" onerror="this.src=\\'/photo/plastinka-audio.png\\'">' +
                        '<div class="cart-item-info">' +
                        '<div class="cart-item-name">' + escapeHtml(item.name) + '</div>' +
                        '<div class="cart-item-price">$' + item.price + '</div>' +
                        '<div class="cart-item-quantity">' +
                        '<button class="quantity-btn" onclick="updateQuantity(\\'' + item.product_id + '\\', \\'decrease\\')">-</button>' +
                        '<span>' + item.quantity + '</span>' +
                        '<button class="quantity-btn" onclick="updateQuantity(\\'' + item.product_id + '\\', \\'increase\\')">+</button>' +
                        '</div></div>' +
                        '<button class="remove-btn" onclick="removeFromCart(\\'' + item.product_id + '\\')"><i class="fas fa-trash"></i></button>' +
                        '</div>';
                }
                container.innerHTML = html;
                
                const totalDiv = document.getElementById('cartTotal');
                totalDiv.style.display = 'block';
                totalDiv.innerHTML = '<div class="cart-total"><span>Итого:</span><span class="total-price">$' + total + '</span></div><button class="checkout-btn" onclick="checkout()">Оформить заказ</button>';
            } catch (error) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><h3>Ошибка загрузки</h3></div>';
            }
        }
        
        async function updateQuantity(productId, action) {
            try {
                await fetch('/api/cart/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_id: productId, action: action })
                });
                loadCart();
            } catch (error) {
                showToastMobile('Ошибка обновления', true);
            }
        }
        
        async function removeFromCart(productId) {
            try {
                await fetch('/api/cart/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_id: productId })
                });
                loadCart();
                showToastMobile('Товар удален из корзины', false);
            } catch (error) {
                showToastMobile('Ошибка удаления', true);
            }
        }
        
        async function checkout() {
            if (confirm('Подтвердите заказ?')) {
                try {
                    await fetch('/api/order', { method: 'POST' });
                    alert('✅ Заказ оформлен! Спасибо за покупку!');
                    loadCart();
                } catch (error) {
                    alert('❌ Ошибка оформления заказа');
                }
            }
        }
        
        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        
        loadCart();
        </script>
    `;
    
    res.send(renderMobilePage('Корзина', content, user, 'cart'));
});

app.get("/api/cart/list", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    
    db.all("SELECT * FROM carts WHERE user_id = ?", [userId], (err, cartItems) => {
        if (err || !cartItems) return res.json({ items: [] });
        
        const items = [];
        let completed = 0;
        
        if (cartItems.length === 0) return res.json({ items: [] });
        
        cartItems.forEach(item => {
            const parts = item.product_id.split('_');
            const type = parts[0];
            const id = parts[1];
            
            if (type === 'player') {
                db.get("SELECT * FROM players WHERE id = ?", [id], (err, player) => {
                    if (player) {
                        items.push({
                            product_id: item.product_id,
                            type: 'player',
                            name: player.name,
                            artist: 'Проигрыватель',
                            price: player.price,
                            image: player.image,
                            quantity: item.quantity
                        });
                    }
                    completed++;
                    if (completed === cartItems.length) res.json({ items: items });
                });
            } else {
                db.get("SELECT * FROM products WHERE id = ?", [id], (err, product) => {
                    if (product) {
                        items.push({
                            product_id: item.product_id,
                            type: 'product',
                            name: product.name,
                            artist: product.artist,
                            price: product.price,
                            image: product.image,
                            quantity: item.quantity
                        });
                    }
                    completed++;
                    if (completed === cartItems.length) res.json({ items: items });
                });
            }
        });
    });
});

app.post("/api/order", requireAuth, (req, res) => {
    const userId = req.session.user.id;
    db.run("DELETE FROM carts WHERE user_id = ?", [userId], (err) => {
        res.json({ success: true });
    });
});

// ============================================================
// АВТОРИЗАЦИЯ
// ============================================================
app.get("/login", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Вход · Plastinka</title>
        <style>
            body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
            .login-container{max-width:400px;width:100%;padding:40px;background:#181818;border-radius:16px;text-align:center;}
            .login-container img{width:150px;margin-bottom:20px;}
            h1{color:white;margin-bottom:10px;}
            .subtitle{color:#888;margin-bottom:30px;}
            .form-group{margin-bottom:20px;text-align:left;}
            .form-group label{display:block;margin-bottom:8px;color:#aaa;}
            .form-group input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;box-sizing:border-box;}
            .login-btn{width:100%;padding:14px;border:none;background:linear-gradient(45deg,#ff0000,#990000);color:#fff;border-radius:10px;font-weight:bold;cursor:pointer;}
            .register-link{margin-top:20px;color:#aaa;}
            .register-link a{color:#ff0000;text-decoration:none;}
            .error-message{background:rgba(255,0,0,0.1);border:1px solid #ff0000;color:#ff0000;padding:10px;border-radius:8px;margin-bottom:20px;}
        </style>
        </head>
        <body>
        <div class="login-container">
            <img src="/photo/logo.svg">
            <h1>Добро пожаловать</h1>
            <div class="subtitle">Войдите в свой аккаунт</div>
            ${req.query.error ? '<div class="error-message">❌ Неверное имя пользователя или пароль</div>' : ''}
            <form action="/login" method="POST">
                <div class="form-group"><label>Имя пользователя</label><input type="text" name="username" required></div>
                <div class="form-group"><label>Пароль</label><input type="password" name="password" required></div>
                <button type="submit" class="login-btn">Войти</button>
            </form>
            <div class="register-link">Нет аккаунта? <a href="/register">Зарегистрироваться</a></div>
            <a href="/" style="display:block;margin-top:20px;color:#666;">← Вернуться на главную</a>
        </div>
        </body>
        </html>
    `);
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.user = { id: user.id, username: user.username, role: user.role, avatar: user.avatar };
            res.redirect("/");
        } else {
            res.redirect("/login?error=1");
        }
    });
});

app.get("/register", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Регистрация · Plastinka</title>
        <style>
            body{background:#0f0f0f;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
            .register-container{max-width:400px;width:100%;padding:40px;background:#181818;border-radius:16px;text-align:center;}
            .register-container img{width:150px;margin-bottom:20px;}
            h1{color:white;margin-bottom:10px;}
            .subtitle{color:#888;margin-bottom:30px;}
            .form-group{margin-bottom:20px;text-align:left;}
            .form-group label{display:block;margin-bottom:8px;color:#aaa;}
            .form-group input{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;box-sizing:border-box;}
            .register-btn{width:100%;padding:14px;border:none;background:linear-gradient(45deg,#ff0000,#990000);color:#fff;border-radius:10px;font-weight:bold;cursor:pointer;}
            .login-link{margin-top:20px;color:#aaa;}
            .login-link a{color:#ff0000;text-decoration:none;}
            .error-message{background:rgba(255,0,0,0.1);border:1px solid #ff0000;color:#ff0000;padding:10px;border-radius:8px;margin-bottom:20px;}
        </style>
        </head>
        <body>
        <div class="register-container">
            <img src="/photo/logo.svg">
            <h1>Создать аккаунт</h1>
            <div class="subtitle">Присоединяйтесь к Plastinka</div>
            ${req.query.error === 'exists' ? '<div class="error-message">❌ Пользователь с таким именем уже существует</div>' : ''}
            <form action="/register" method="POST">
                <div class="form-group"><label>Имя пользователя</label><input type="text" name="username" required></div>
                <div class="form-group"><label>Пароль</label><input type="password" name="password" required></div>
                <button type="submit" class="register-btn">Зарегистрироваться</button>
            </form>
            <div class="login-link">Уже есть аккаунт? <a href="/login">Войти</a></div>
            <a href="/" style="display:block;margin-top:20px;color:#666;">← Вернуться на главную</a>
        </div>
        </body>
        </html>
    `);
});

app.post("/register", (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user) return res.redirect("/register?error=exists");
        const hash = bcrypt.hashSync(password, 10);
        db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, hash, "user"], function(err) {
            if (err) return res.redirect("/register?error=exists");
            res.redirect("/login?registered=1");
        });
    });
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// ============================================================
// АДМИН ПАНЕЛЬ (УПРОЩЕННАЯ)
// ============================================================
app.get("/admin", requireAdmin, (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, products) => {
        db.all("SELECT * FROM players ORDER BY id DESC", [], (err, players) => {
            let productsHtml = "";
            products.forEach(p => {
                productsHtml += `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.artist)}</td><td>$${p.price}</td><td><button onclick="editProduct(${p.id})">✏️</button> <button onclick="deleteProduct(${p.id})">🗑️</button></td></tr>`;
            });
            
            let playersHtml = "";
            players.forEach(p => {
                playersHtml += `<tr><td>${escapeHtml(p.name)}</td><td>$${p.price}</td><td><button onclick="editPlayer(${p.id})">✏️</button> <button onclick="deletePlayer(${p.id})">🗑️</button></td></tr>`;
            });
            
            res.send(`
                <!DOCTYPE html>
                <html>
                <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Админ панель</title>
                <style>
                    *{margin:0;padding:0;box-sizing:border-box;}
                    body{background:#0f0f0f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;}
                    .container{max-width:1200px;margin:0 auto;}
                    h1{color:#ff0000;margin-bottom:20px;}
                    h2{margin:30px 0 15px;color:#ff7a2f;}
                    table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:12px;overflow:hidden;}
                    th,td{padding:12px;text-align:left;border-bottom:1px solid #333;}
                    th{background:#222;color:#ff7a2f;}
                    button{padding:8px 16px;margin:0 4px;border:none;border-radius:6px;cursor:pointer;}
                    .add-btn{background:linear-gradient(45deg,#4CAF50,#2e7d32);color:white;}
                    .edit-btn{background:#ffc107;color:#000;}
                    .delete-btn{background:#f44336;color:white;}
                    .nav{display:flex;gap:20px;margin-bottom:30px;}
                    .nav a{color:#fff;text-decoration:none;padding:10px 20px;background:#1a1a1a;border-radius:8px;}
                    .nav a:hover{background:#ff0000;}
                    .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);justify-content:center;align-items:center;}
                    .modal-content{background:#1e1e1e;padding:30px;border-radius:16px;width:90%;max-width:500px;}
                    .modal-content input,.modal-content textarea{width:100%;padding:10px;margin:10px 0;background:#111;border:1px solid #333;color:#fff;border-radius:8px;}
                    .modal-buttons{display:flex;gap:10px;margin-top:20px;}
                    .modal-buttons button{flex:1;}
                </style>
                </head>
                <body>
                <div class="container">
                    <div class="nav">
                        <a href="/">🏠 На сайт</a>
                        <a href="/logout">🚪 Выйти</a>
                        <a href="/admin/settings">⚙️ Настройки главной</a>
                    </div>
                    <h1>👑 Админ панель</h1>
                    
                    <div style="margin-bottom:20px;">
                        <button class="add-btn" onclick="openAddProductModal()">+ Добавить пластинку</button>
                        <button class="add-btn" onclick="openAddPlayerModal()">+ Добавить проигрыватель</button>
                    </div>
                    
                    <h2>📀 Пластинки</h2>
                    <table><thead><tr><th>Название</th><th>Исполнитель</th><th>Цена</th><th>Действия</th></tr></thead><tbody>${productsHtml || '<tr><td colspan="4">Нет пластинок</td></tr>'}</tbody></table>
                    
                    <h2>🎵 Проигрыватели</h2>
                    <table><thead><tr><th>Название</th><th>Цена</th><th>Действия</th></tr></thead><tbody>${playersHtml || '<tr><td colspan="3">Нет проигрывателей</td></tr>'}</tbody></table>
                </div>
                
                <div id="modal" class="modal"><div class="modal-content"><h3 id="modalTitle">Добавить товар</h3><form id="itemForm" enctype="multipart/form-data"><input type="hidden" id="itemId" name="id"><input type="hidden" id="itemType" name="type"><input type="text" id="itemName" name="name" placeholder="Название" required><input type="text" id="itemArtist" name="artist" placeholder="Исполнитель"><input type="text" id="itemGenre" name="genre" placeholder="Жанр"><input type="text" id="itemYear" name="year" placeholder="Год"><input type="number" id="itemPrice" name="price" placeholder="Цена" step="0.01" required><textarea id="itemDescription" name="description" placeholder="Описание"></textarea><input type="file" id="itemImage" name="image" accept="image/*"><input type="file" id="itemAudio" name="audio" accept="audio/*"><div class="modal-buttons"><button type="submit">Сохранить</button><button type="button" onclick="closeModal()">Отмена</button></div></form></div></div>
                
                <script>
                const modal = document.getElementById('modal');
                const itemForm = document.getElementById('itemForm');
                
                function openAddProductModal() {
                    document.getElementById('modalTitle').innerText = 'Добавить пластинку';
                    document.getElementById('itemType').value = 'product';
                    document.getElementById('itemId').value = '';
                    itemForm.reset();
                    modal.style.display = 'flex';
                }
                
                function openAddPlayerModal() {
                    document.getElementById('modalTitle').innerText = 'Добавить проигрыватель';
                    document.getElementById('itemType').value = 'player';
                    document.getElementById('itemId').value = '';
                    itemForm.reset();
                    modal.style.display = 'flex';
                }
                
                function editProduct(id) {
                    fetch('/admin/get-item', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'product', id: id })
                    }).then(r => r.json()).then(data => {
                        document.getElementById('modalTitle').innerText = 'Редактировать пластинку';
                        document.getElementById('itemType').value = 'product';
                        document.getElementById('itemId').value = id;
                        document.getElementById('itemName').value = data.name || '';
                        document.getElementById('itemArtist').value = data.artist || '';
                        document.getElementById('itemGenre').value = data.genre || '';
                        document.getElementById('itemYear').value = data.year || '';
                        document.getElementById('itemPrice').value = data.price || '';
                        document.getElementById('itemDescription').value = data.description || '';
                        modal.style.display = 'flex';
                    });
                }
                
                function editPlayer(id) {
                    fetch('/admin/get-item', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ type: 'player', id: id })
                    }).then(r => r.json()).then(data => {
                        document.getElementById('modalTitle').innerText = 'Редактировать проигрыватель';
                        document.getElementById('itemType').value = 'player';
                        document.getElementById('itemId').value = id;
                        document.getElementById('itemName').value = data.name || '';
                        document.getElementById('itemPrice').value = data.price || '';
                        document.getElementById('itemDescription').value = data.description || '';
                        modal.style.display = 'flex';
                    });
                }
                
                function deleteProduct(id) {
                    if (confirm('Удалить пластинку?')) {
                        fetch('/admin/delete-item', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type: 'product', id: id })
                        }).then(() => location.reload());
                    }
                }
                
                function deletePlayer(id) {
                    if (confirm('Удалить проигрыватель?')) {
                        fetch('/admin/delete-item', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type: 'player', id: id })
                        }).then(() => location.reload());
                    }
                }
                
                itemForm.onsubmit = function(e) {
                    e.preventDefault();
                    const formData = new FormData(this);
                    fetch('/admin/save-item', { method: 'POST', body: formData }).then(() => location.reload());
                };
                
                function closeModal() { modal.style.display = 'none'; }
                </script>
                </body>
                </html>
            `);
        });
    });
});

app.get("/admin/settings", requireAdmin, (req, res) => {
    db.get("SELECT value FROM site_settings WHERE key = 'homepage_products'", [], (err, setting) => {
        const currentMode = setting ? setting.value : 'last_added';
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><title>Настройки главной</title>
            <style>
                body{background:#0f0f0f;color:#fff;font-family:sans-serif;padding:20px;}
                .container{max-width:500px;margin:0 auto;background:#1a1a1a;padding:30px;border-radius:16px;}
                h1{color:#ff0000;margin-bottom:20px;}
                .option{margin:15px 0;padding:15px;background:#222;border-radius:8px;cursor:pointer;}
                .option.selected{border:2px solid #ff0000;background:#2a2a2a;}
                .save-btn{width:100%;padding:12px;background:linear-gradient(45deg,#ff0000,#990000);border:none;border-radius:8px;color:white;font-weight:bold;cursor:pointer;margin-top:20px;}
                .back{display:block;margin-top:20px;color:#aaa;text-align:center;}
            </style>
            </head>
            <body>
            <div class="container">
                <h1>⚙️ Настройка главной страницы</h1>
                <form action="/admin/settings" method="POST">
                    <div class="option ${currentMode === 'last_added' ? 'selected' : ''}" onclick="selectOption('last_added')">
                        <input type="radio" name="homepage_products" value="last_added" id="last_added" ${currentMode === 'last_added' ? 'checked' : ''} style="margin-right:10px;">
                        <label for="last_added"><strong>Последние добавленные</strong><br><small>Показывать 6 последних пластинок</small></label>
                    </div>
                    <div class="option ${currentMode === 'all' ? 'selected' : ''}" onclick="selectOption('all')">
                        <input type="radio" name="homepage_products" value="all" id="all" ${currentMode === 'all' ? 'checked' : ''} style="margin-right:10px;">
                        <label for="all"><strong>Все пластинки</strong><br><small>Показывать все пластинки (до 12)</small></label>
                    </div>
                    <button type="submit" class="save-btn">Сохранить настройки</button>
                </form>
                <a href="/admin" class="back">← Вернуться в админ панель</a>
            </div>
            <script>
                function selectOption(value) {
                    document.getElementById(value).checked = true;
                    document.querySelectorAll('.option').forEach(opt => opt.classList.remove('selected'));
                    event.currentTarget.classList.add('selected');
                }
            </script>
            </body>
            </html>
        `);
    });
});

app.post("/admin/settings", requireAdmin, (req, res) => {
    const { homepage_products } = req.body;
    db.run("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)", ['homepage_products', homepage_products], (err) => {
        res.redirect("/admin/settings?saved=1");
    });
});

app.post("/admin/get-item", requireAdmin, express.json(), (req, res) => {
    const { type, id } = req.body;
    const table = type === 'product' ? 'products' : 'players';
    db.get(`SELECT * FROM ${table} WHERE id = ?`, [id], (err, item) => {
        res.json(item || {});
    });
});

app.post("/admin/save-item", requireAdmin, upload.fields([{ name: 'image' }, { name: 'audio' }]), (req, res) => {
    const { type, id, name, artist, genre, year, price, description } = req.body;
    const imageFile = req.files?.image?.[0];
    const audioFile = req.files?.audio?.[0];
    
    if (type === 'product') {
        if (id && id !== '' && id !== 'undefined') {
            let query = "UPDATE products SET name=?, artist=?, price=?, description=?, genre=?, year=?";
            let params = [name, artist, parseFloat(price), description || '', genre || '', year || ''];
            if (imageFile) { query += ", image=?"; params.push(imageFile.filename); }
            if (audioFile) { query += ", audio=?"; params.push(audioFile.filename); }
            query += " WHERE id=?";
            params.push(parseInt(id));
            db.run(query, params, (err) => res.json({ success: !err }));
        } else {
            db.run("INSERT INTO products (name, artist, price, image, audio, description, genre, year) VALUES (?,?,?,?,?,?,?,?)",
                [name, artist, parseFloat(price), imageFile?.filename || null, audioFile?.filename || null, description || '', genre || '', year || ''],
                (err) => res.json({ success: !err }));
        }
    } else {
        if (id && id !== '' && id !== 'undefined') {
            let query = "UPDATE players SET name=?, price=?, description=?";
            let params = [name, parseFloat(price), description || ''];
            if (imageFile) { query += ", image=?"; params.push(imageFile.filename); }
            query += " WHERE id=?";
            params.push(parseInt(id));
            db.run(query, params, (err) => res.json({ success: !err }));
        } else {
            db.run("INSERT INTO players (name, price, image, description) VALUES (?,?,?,?)",
                [name, parseFloat(price), imageFile?.filename || null, description || ''],
                (err) => res.json({ success: !err }));
        }
    }
});

app.post("/admin/delete-item", requireAdmin, express.json(), (req, res) => {
    const { type, id } = req.body;
    const table = type === 'product' ? 'products' : 'players';
    db.run(`DELETE FROM ${table} WHERE id=?`, [id], (err) => res.json({ success: !err }));
});

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================
function generateStarRatingHTML(rating, votesCount) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let starsHtml = '';
    
    for (let i = 1; i <= 5; i++) {
        if (i <= fullStars) {
            starsHtml += '<i class="fas fa-star star filled"></i>';
        } else if (i === fullStars + 1 && hasHalfStar) {
            starsHtml += '<i class="fas fa-star-half-alt star filled"></i>';
        } else {
            starsHtml += '<i class="far fa-star star"></i>';
        }
    }
    
    return `<div class="rating-stars">${starsHtml}<span class="rating-value">${rating}</span><span class="votes-count">(${votesCount})</span></div>`;
}

function renderMobilePage(title, content, user, activeTab = 'home') {
    return `<!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes, viewport-fit=cover">
        <title>${escapeHtml(title)} · Plastinka</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            *{margin:0;padding:0;box-sizing:border-box;}
            body{background:#0f0f0f;color:white;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding-bottom:70px;min-height:100vh;}
            .top-bar{background:#0a0a0a;padding:12px 16px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100;border-bottom:1px solid #222;}
            .top-bar .logo{height:32px;width:auto;}
            .search-bar{flex:1;background:#1a1a1a;border-radius:20px;padding:8px 16px;display:flex;align-items:center;gap:8px;color:#888;font-size:14px;border:1px solid #333;cursor:pointer;}
            .search-bar i{color:#ff0000;}
            .content{padding:16px;}
            .section-title{font-size:20px;font-weight:bold;margin:20px 0 16px;color:white;padding-left:12px;position:relative;}
            .section-title::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#ff0000,#990000);border-radius:2px;}
            .products-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;}
            .product-card{background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #333;transition:transform 0.2s,border-color 0.2s;cursor:pointer;}
            .product-card:hover{transform:translateY(-2px);border-color:#ff0000;}
            .product-image{position:relative;aspect-ratio:1;background:#111;}
            .product-image img{width:100%;height:100%;object-fit:cover;}
            .vinyl-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;}
            .product-card:hover .vinyl-overlay{opacity:1;}
            .vinyl-icon{width:50px;height:50px;animation:spin 4s linear infinite;animation-play-state:paused;}
            .product-card:hover .vinyl-icon{animation-play-state:running;}
            @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
            .product-info{padding:12px;}
            .product-name{font-weight:bold;font-size:14px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
            .product-artist{font-size:12px;color:#888;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
            .rating-stars{display:flex;align-items:center;gap:4px;margin:6px 0;}
            .rating-stars .star{font-size:10px;color:#444;}
            .rating-stars .star.filled{color:#ff7a2f;}
            .rating-value{font-size:10px;color:#ff7a2f;margin-left:4px;}
            .votes-count{font-size:9px;color:#666;}
            .product-price{color:#ff0000;font-weight:bold;font-size:16px;margin-bottom:8px;}
            .product-actions{display:flex;gap:8px;}
            .action-btn{flex:1;background:#333;border:none;color:white;padding:8px;border-radius:8px;font-size:14px;cursor:pointer;transition:0.2s;}
            .action-btn:hover{opacity:0.8;background:#ff0000;}
            .bottom-nav{position:fixed;bottom:0;left:0;right:0;background:#0a0a0a;display:flex;justify-content:space-around;padding:8px 0 12px;border-top:1px solid #222;z-index:1000;}
            .nav-item{color:#888;text-decoration:none;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;flex:1;transition:color 0.2s;}
            .nav-item i{font-size:20px;}
            .nav-item.active{color:#ff0000;}
            .auth-prompt{background:linear-gradient(45deg,#ff0000,#990000);padding:20px;border-radius:12px;text-align:center;margin-top:20px;}
            .auth-prompt p{margin-bottom:12px;font-size:14px;}
            .auth-btn{display:inline-block;background:white;color:#ff0000;padding:10px 30px;border-radius:30px;text-decoration:none;font-weight:bold;font-size:14px;}
            .empty-state{text-align:center;padding:60px 20px;}
            .empty-icon{font-size:60px;color:#333;margin-bottom:20px;}
            .empty-state h3{margin-bottom:8px;}
            .empty-state p{color:#888;margin-bottom:20px;}
            .empty-btn{display:inline-block;background:linear-gradient(45deg,#ff0000,#990000);color:white;padding:12px 24px;border-radius:30px;text-decoration:none;font-weight:bold;}
            .modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);backdrop-filter:blur(5px);z-index:2000;justify-content:center;align-items:center;}
            .modal-overlay.active{display:flex;}
            .modal-content{background:linear-gradient(145deg,#2a2a2a,#1e1e1e);border-radius:20px;padding:24px;max-width:90%;width:350px;position:relative;border:1px solid #ff7a2f;max-height:85vh;overflow-y:auto;}
            .modal-close{position:absolute;top:15px;right:15px;background:none;border:none;color:#fff;font-size:30px;cursor:pointer;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,0,0,0.1);transition:0.3s;}
            .modal-close:hover{background:#ff0000;transform:rotate(90deg);}
            .modal-player-image{width:100%;max-height:200px;object-fit:contain;margin-bottom:16px;border-radius:12px;}
            .modal-title{font-size:22px;color:#ff7a2f;margin-bottom:8px;font-weight:bold;}
            .modal-artist{color:#aaa;font-size:16px;margin-bottom:12px;}
            .modal-tags{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;}
            .modal-tag{background:rgba(255,122,47,0.2);padding:4px 12px;border-radius:20px;font-size:11px;color:#ff7a2f;}
            .rating-section{margin:15px 0;}
            .rating-label{font-size:12px;color:#888;margin-bottom:5px;}
            .rating-stars-large{display:flex;gap:8px;margin-bottom:5px;}
            .rating-stars-large .star{font-size:20px;cursor:pointer;color:#444;}
            .rating-stars-large .star.filled{color:#ff7a2f;}
            .rating-votes{font-size:11px;color:#666;}
            .comments-list{background:#111;border-radius:12px;padding:12px;max-height:200px;overflow-y:auto;margin:15px 0;}
            .comment-item{padding:10px 0;border-bottom:1px solid #333;}
            .comment-header{display:flex;justify-content:space-between;margin-bottom:5px;}
            .comment-user{color:#ff7a2f;font-weight:bold;font-size:12px;}
            .comment-date{color:#666;font-size:10px;}
            .comment-text{color:#ccc;font-size:13px;}
            .modal-description{color:#ccc;line-height:1.5;margin-bottom:16px;font-size:14px;}
            .modal-price{font-size:28px;color:#fff;font-weight:bold;margin-bottom:20px;}
            .modal-price span{color:#ff7a2f;font-size:16px;}
            .modal-actions{display:flex;gap:12px;margin-bottom:12px;}
            .modal-add-to-cart{flex:1;padding:12px;background:linear-gradient(45deg,#ff7a2f,#ff0000);border:none;border-radius:10px;color:white;font-size:16px;font-weight:bold;cursor:pointer;}
            .modal-fav-btn{width:48px;background:rgba(255,255,255,0.1);border:1px solid #ff0000;border-radius:10px;color:#ff0000;font-size:20px;cursor:pointer;}
            .modal-fav-btn.active{background:#ff0000;color:white;}
            .modal-play-btn{width:100%;padding:10px;background:rgba(255,255,255,0.1);border:1px solid #ff7a2f;border-radius:10px;color:#ff7a2f;font-size:14px;cursor:pointer;margin-top:10px;}
            .modal-review-btn{width:100%;margin:10px 0;padding:10px;background:rgba(255,122,47,0.2);border:1px solid #ff7a2f;border-radius:10px;color:#ff7a2f;font-size:14px;cursor:pointer;}
            .toast-notification{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#4CAF50;color:white;padding:10px 20px;border-radius:8px;z-index:3000;animation:fadeOut 2s forwards;font-size:14px;white-space:nowrap;}
            @keyframes fadeOut{0%{opacity:1;}70%{opacity:1;}100%{opacity:0;visibility:hidden;}}
            .profile-header{text-align:center;padding:20px;}
            .profile-avatar{width:100px;height:100px;border-radius:50%;border:3px solid #ff0000;margin-bottom:16px;object-fit:cover;}
            .profile-name{font-size:24px;margin-bottom:4px;}
            .profile-role{color:#888;}
            .profile-stats{display:flex;justify-content:center;gap:40px;padding:20px;background:#1a1a1a;border-radius:12px;margin:20px 0;}
            .stat{text-align:center;}
            .stat-value{font-size:24px;font-weight:bold;color:#ff0000;}
            .stat-label{color:#888;font-size:12px;}
            .profile-menu{background:#1a1a1a;border-radius:12px;overflow:hidden;}
            .menu-item{display:flex;align-items:center;gap:12px;padding:16px;color:white;text-decoration:none;border-bottom:1px solid #333;cursor:pointer;}
            .admin-panel-btn{display:block;background:linear-gradient(45deg,#ff0000,#990000);color:white;text-decoration:none;padding:16px;border-radius:12px;text-align:center;margin:20px 0;font-weight:bold;}
            .logout-btn{display:block;background:#222;color:#ff4444;text-decoration:none;padding:16px;border-radius:12px;text-align:center;margin-top:20px;border:1px solid #ff4444;}
            .cart-item{display:flex;align-items:center;gap:12px;background:#1a1a1a;padding:12px;border-radius:12px;margin-bottom:12px;}
            .cart-item-image{width:70px;height:70px;object-fit:cover;border-radius:8px;}
            .cart-item-info{flex:1;}
            .cart-item-name{font-weight:bold;font-size:14px;margin-bottom:4px;}
            .cart-item-price{color:#ff0000;font-weight:bold;margin-bottom:8px;}
            .cart-item-quantity{display:flex;align-items:center;gap:10px;}
            .quantity-btn{width:28px;height:28px;border-radius:50%;background:#333;border:none;color:white;cursor:pointer;font-size:16px;}
            .remove-btn{background:transparent;border:none;color:#ff4444;font-size:18px;cursor:pointer;padding:8px;}
            .cart-total{background:#1a1a1a;padding:16px;border-radius:12px;margin-top:20px;display:flex;justify-content:space-between;align-items:center;}
            .total-price{font-size:22px;font-weight:bold;color:#ff0000;}
            .checkout-btn{width:100%;background:linear-gradient(45deg,#ff0000,#990000);border:none;color:white;padding:14px;border-radius:12px;font-weight:bold;font-size:16px;margin-top:16px;cursor:pointer;}
            .avatar-container{position:relative;display:inline-block;cursor:pointer;}
            .avatar-overlay{position:absolute;bottom:5px;right:5px;background:#ff0000;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #1a1a1a;}
            .avatar-overlay i{color:white;font-size:14px;}
            .big-search{margin-bottom:20px;}
            @media (max-width:480px){.products-grid{grid-template-columns:1fr;}}
        </style>
    </head>
    <body>
    <div class="top-bar">
        <img src="/photo/logo.svg" class="logo" alt="Plastinka">
        <div class="search-bar" onclick="window.location='/search'">
            <i class="fas fa-search"></i>
            <span>Поиск</span>
        </div>
    </div>
    <div class="content">${content}</div>
    <nav class="bottom-nav">
        <a href="/" class="nav-item ${activeTab === 'home' ? 'active' : ''}"><i class="fas fa-home"></i><span>Главная</span></a>
        <a href="/catalog" class="nav-item ${activeTab === 'catalog' ? 'active' : ''}"><i class="fas fa-record-vinyl"></i><span>Каталог</span></a>
        <a href="/favorites" class="nav-item ${activeTab === 'favorites' ? 'active' : ''}"><i class="fas fa-heart"></i><span>Избранное</span></a>
        <a href="/cart" class="nav-item ${activeTab === 'cart' ? 'active' : ''}"><i class="fas fa-shopping-cart"></i><span>Корзина</span></a>
        <a href="/profile" class="nav-item ${activeTab === 'profile' ? 'active' : ''}"><i class="fas fa-user"></i><span>Профиль</span></a>
    </nav>
    <script>
    const tg = window.Telegram?.WebApp;
    let currentModalProductId = null;
    let currentModalProductRealId = null;
    let currentSelectedRating = null;
    let currentAudio = null;
    
    if (tg) {
        tg.expand();
        if (window.history.length > 1) {
            tg.BackButton.show();
            tg.BackButton.onClick(() => window.history.back());
        }
        const tgUser = tg.initDataUnsafe?.user;
        if (tgUser && tgUser.id && !${!!user}) {
            fetch('/api/telegram-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: tgUser.id,
                    first_name: tgUser.first_name || '',
                    last_name: tgUser.last_name || '',
                    username: tgUser.username || '',
                    photo_url: tgUser.photo_url || ''
                })
            }).then(res => res.json()).then(data => {
                if (data.success) window.location.reload();
            }).catch(err => console.error('Auth error:', err));
        }
    }
    
    function showToastMobile(message, isError) {
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.innerHTML = (isError ? '❌ ' : '✅ ') + message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
    
    function addToCartMobile(id) {
        fetch('/api/cart/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        }).then(() => showToastMobile('Товар добавлен в корзину', false));
    }
    
    function toggleFavoriteMobile(id) {
        fetch('/api/favorites/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id })
        }).then(() => showToastMobile('Избранное обновлено', false));
    }
    
    function playVinylAudio(audioUrl) {
        if (!audioUrl) return;
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
        }
        currentAudio = new Audio(audioUrl);
        currentAudio.play().catch(e => console.log('Audio error:', e));
    }
    
    function showProductModal(id, name, artist, price, image, description, genre, year, audio) {
        currentModalProductId = 'product_' + id;
        currentModalProductRealId = id;
        document.getElementById('productModalImage').src = image;
        document.getElementById('productModalTitle').innerText = name;
        document.getElementById('productModalArtist').innerText = artist;
        document.getElementById('productModalTags').innerHTML = '<span class="modal-tag">' + genre + '</span><span class="modal-tag">' + year + '</span>';
        document.getElementById('productModalDescription').innerText = description;
        document.getElementById('productModalPrice').innerHTML = price + ' <span>$</span>';
        
        if (audio) {
            document.getElementById('productModalAudio').innerHTML = audio;
            document.getElementById('productModalPlayBtn').style.display = 'flex';
        } else {
            document.getElementById('productModalPlayBtn').style.display = 'none';
        }
        
        fetch('/api/rating/' + id).then(r => r.json()).then(data => {
            renderStarsInModal('modalRatingStars', parseFloat(data.avg_rating), id);
            document.getElementById('modalRatingVotes').innerText = '(' + data.votes_count + ' оценок)';
            renderComments(data.comments, 'modalCommentsList');
        });
        
        document.getElementById('productModal').classList.add('active');
    }
    
    function closeProductModal() {
        document.getElementById('productModal').classList.remove('active');
        if (currentAudio) currentAudio.pause();
    }
    
    function renderStarsInModal(containerId, rating, productId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        let starsHtml = '';
        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 >= 0.5;
        for (let i = 1; i <= 5; i++) {
            if (i <= fullStars) starsHtml += '<i class="fas fa-star star filled" data-value="' + i + '"></i>';
            else if (i === fullStars + 1 && hasHalfStar) starsHtml += '<i class="fas fa-star-half-alt star filled" data-value="' + i + '"></i>';
            else starsHtml += '<i class="far fa-star star" data-value="' + i + '"></i>';
        }
        container.innerHTML = starsHtml;
    }
    
    function renderComments(comments, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!comments || comments.length === 0) {
            container.innerHTML = '<div class="no-comments">📝 Пока нет комментариев. Будьте первым!</div>';
            return;
        }
        let html = '';
        comments.forEach(c => {
            html += '<div class="comment-item"><div class="comment-header"><span class="comment-user">' + escapeHtml(c.username) + '</span><span class="comment-date">' + new Date(c.created_at).toLocaleDateString() + '</span></div><div class="comment-text">' + escapeHtml(c.comment || '') + '</div></div>';
        });
        container.innerHTML = html;
    }
    
    function addToCartFromModal() {
        if (currentModalProductId) {
            fetch('/api/cart/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: currentModalProductId })
            }).then(() => {
                showToastMobile('Товар добавлен в корзину', false);
                closeProductModal();
            });
        }
    }
    
    function toggleFavoriteFromModal() {
        if (currentModalProductId) {
            fetch('/api/favorites/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: currentModalProductId })
            }).then(() => {
                showToastMobile('Избранное обновлено', false);
            });
        }
    }
    
    function playModalPreview() {
        const audioFile = document.getElementById('productModalAudio').innerText;
        if (audioFile) {
            if (currentAudio) currentAudio.pause();
            currentAudio = new Audio('/audio/' + audioFile);
            currentAudio.play();
        }
    }
    
    let reviewProductId = null;
    let reviewSelectedRating = 0;
    
    function openReviewModal() {
        if (!${!!user}) {
            showToastMobile('Войдите в аккаунт, чтобы оставить отзыв', true);
            return;
        }
        reviewProductId = currentModalProductRealId;
        reviewSelectedRating = 0;
        document.querySelectorAll('#reviewStars i').forEach(star => {
            star.className = 'far fa-star';
            star.style.color = '';
        });
        document.getElementById('reviewComment').value = '';
        document.getElementById('reviewModal').classList.add('active');
    }
    
    function closeReviewModal() {
        document.getElementById('reviewModal').classList.remove('active');
    }
    
    document.querySelectorAll('#reviewStars i').forEach(star => {
        star.addEventListener('click', function() {
            reviewSelectedRating = parseInt(this.dataset.rating);
            document.querySelectorAll('#reviewStars i').forEach((s, idx) => {
                if (idx < reviewSelectedRating) {
                    s.className = 'fas fa-star';
                    s.style.color = '#ff7a2f';
                } else {
                    s.className = 'far fa-star';
                    s.style.color = '';
                }
            });
        });
    });
    
    function submitReview() {
        if (!reviewSelectedRating) {
            showToastMobile('Выберите оценку!', true);
            return;
        }
        const comment = document.getElementById('reviewComment').value;
        fetch('/api/rating/' + reviewProductId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating: reviewSelectedRating, comment: comment })
        }).then(r => r.json()).then(data => {
            if (data.success) {
                showToastMobile('Спасибо за отзыв!', false);
                closeReviewModal();
                closeProductModal();
            }
        }).catch(err => showToastMobile('Ошибка отправки', true));
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    
    document.querySelectorAll('.product-card').forEach(card => {
        const audioUrl = card.dataset.audioUrl;
        if (audioUrl) {
            let pressTimer = null;
            card.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => playVinylAudio(audioUrl), 500);
            });
            card.addEventListener('touchend', () => clearTimeout(pressTimer));
            card.addEventListener('touchcancel', () => clearTimeout(pressTimer));
        }
    });
    
    document.querySelectorAll('.rating-stars').forEach(container => {
        const productId = container.dataset.productId;
        if (productId) {
            fetch('/api/rating/' + productId).then(r => r.json()).then(data => {
                if (data.avg_rating) {
                    const stars = container.querySelectorAll('.star');
                    const rating = parseFloat(data.avg_rating);
                    const fullStars = Math.floor(rating);
                    const hasHalfStar = rating % 1 >= 0.5;
                    stars.forEach((star, idx) => {
                        if (idx < fullStars) star.classList.add('filled');
                        else if (idx === fullStars && hasHalfStar) star.classList.add('filled');
                        else star.classList.remove('filled');
                    });
                    const ratingValue = container.querySelector('.rating-value');
                    if (ratingValue) ratingValue.textContent = rating;
                    const votesSpan = container.querySelector('.votes-count');
                    if (votesSpan) votesSpan.textContent = '(' + data.votes_count + ')';
                }
            });
        }
    });
    </script>
    </body>
    </html>`;
}

// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

module.exports = app;