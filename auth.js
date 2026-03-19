/**
 * auth.js — підключи на КОЖНУ сторінку (крім login.html) першим скриптом у <head>:
 *
 *   <script src="auth.js"></script>
 *
 * Як тільки сторінка починає завантажуватись — скрипт перевіряє токен.
 * Якщо токена немає або він протух — одразу редірект на login.html.
 * Сторінка не відобразиться до перевірки (скрипт блокуючий, без defer/async).
 */

(function () {
  // ─── Налаштування ───────────────────────────────────────────────────────
  // !! Замінити на реальний URL твого Cloudflare Worker !!
  var WORKER_URL = "https://dark-morning-bd95.skifchaqwerty.workers.dev";

  var TOKEN_KEY  = "ogonh_token";
  var LOGIN_PAGE = "login.html";
  // ────────────────────────────────────────────────────────────────────────

  // Не блокуємо login.html
  var currentPage = location.pathname.split("/").pop() || "index.html";
  if (currentPage === LOGIN_PAGE) return;

  var token = sessionStorage.getItem(TOKEN_KEY);

  if (!token || isTokenExpired(token)) {
    sessionStorage.removeItem(TOKEN_KEY);
    // Зберігаємо куди повернутись після логіну
    sessionStorage.setItem("ogonh_redirect", location.href);
    location.replace(LOGIN_PAGE);
    // Зупиняємо виконання решти скриптів сторінки
    throw new Error("AUTH_REDIRECT");
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  function isTokenExpired(token) {
    try {
      var parts = token.split(".");
      if (parts.length !== 2) return true;
      var payload = atob(parts[0]);          // "ogonh:TIMESTAMP"
      var exp = parseInt(payload.split(":")[1], 10);
      return isNaN(exp) || Date.now() > exp;
    } catch (e) {
      return true;
    }
  }

  // Публічне API — викликається з login.html після успішного логіну
  window.__ogonhAuth = {
    WORKER_URL: WORKER_URL,
    TOKEN_KEY:  TOKEN_KEY,
    setToken: function(t) { sessionStorage.setItem(TOKEN_KEY, t); },
    logout:   function()  { sessionStorage.removeItem(TOKEN_KEY); location.replace(LOGIN_PAGE); },
  };
})();
