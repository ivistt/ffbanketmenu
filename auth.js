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
  var WORKER_URL = "https://dark-morning-bd95.skifchaqwerty.workers.dev";
  var TOKEN_KEY  = "ogonh_token";
  var SCOPE_KEY  = "ogonh_scope";
  var USER_KEY   = "ogonh_user_label";
  var LOGIN_PAGE = "login.html";

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SCOPE_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  function parseToken(token) {
    try {
      var parts = token.split(".");
      if (parts.length !== 2) return null;
      var payload = atob(parts[0]);
      var bits = payload.split(":");
      if (bits[0] !== "ogonh") return null;
      if (bits.length === 2) {
        var legacyExp = parseInt(bits[1], 10);
        return { scope: "all", exp: legacyExp };
      }
      var exp = parseInt(bits[2], 10);
      return { scope: bits[1] || "all", exp: exp };
    } catch (e) {
      return null;
    }
  }

  function getUserLabel(scope) {
    return scope === "dalnyk"
      ? "Дальник"
      : scope === "main"
        ? "Основа"
        : "Адмін";
  }

  function setSession(token, scope, userLabel) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(SCOPE_KEY, scope || "all");
    sessionStorage.setItem(USER_KEY, userLabel || getUserLabel(scope || "all"));
  }

  function isTokenExpired(token) {
    var parsed = parseToken(token);
    return !parsed || isNaN(parsed.exp) || Date.now() > parsed.exp;
  }

  function syncSessionFromToken(token) {
    var parsed = parseToken(token);
    if (!parsed || isNaN(parsed.exp) || Date.now() > parsed.exp) return false;
    setSession(token, parsed.scope, sessionStorage.getItem(USER_KEY) || getUserLabel(parsed.scope));
    return true;
  }

  window.__ogonhAuth = {
    WORKER_URL: WORKER_URL,
    TOKEN_KEY: TOKEN_KEY,
    SCOPE_KEY: SCOPE_KEY,
    USER_KEY: USER_KEY,
    setToken: function(token) {
      if (!syncSessionFromToken(token)) throw new Error("INVALID_TOKEN");
    },
    setSession: function(data) {
      if (!data || !data.token) throw new Error("INVALID_AUTH_RESPONSE");
      setSession(data.token, data.scope || "all", data.userLabel || getUserLabel(data.scope || "all"));
    },
    getRestaurantScope: function() {
      return sessionStorage.getItem(SCOPE_KEY) || "all";
    },
    getUserLabel: function() {
      return sessionStorage.getItem(USER_KEY) || getUserLabel(sessionStorage.getItem(SCOPE_KEY) || "all");
    },
    logout: function() {
      clearSession();
      location.replace(LOGIN_PAGE);
    },
  };

  var currentPage = location.pathname.split("/").pop() || "index.html";
  if (currentPage === LOGIN_PAGE) return;

  var token = sessionStorage.getItem(TOKEN_KEY);

  if (!token || !syncSessionFromToken(token) || isTokenExpired(token)) {
    clearSession();
    sessionStorage.setItem("ogonh_redirect", location.href);
    location.replace(LOGIN_PAGE);
    throw new Error("AUTH_REDIRECT");
  }
})();
