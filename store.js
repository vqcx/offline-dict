/* 本地存储：自定义词条 + 错题本。全部在浏览器 localStorage 里，离线可用。 */
(function () {
  'use strict';

  var K_ENTRIES = 'dictweb.entries.v1';
  var K_WRONG = 'dictweb.wrong.v1';
  var K_FAV = 'dictweb.fav.v1';

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  var entries = read(K_ENTRIES, {});
  var wrong = read(K_WRONG, {});
  var fav = read(K_FAV, {});

  window.Store = {
    // ---- 自定义词条 ----
    getEntry: function (w) { return entries[w] || null; },
    setEntry: function (w, obj) {
      entries[w] = obj;
      write(K_ENTRIES, entries);
    },
    delEntry: function (w) {
      if (entries[w]) { delete entries[w]; write(K_ENTRIES, entries); }
    },
    allEntries: function () { return entries; },

    // ---- 错题本 ----
    addWrong: function (w) {
      var r = wrong[w] || { n: 0 };
      r.n += 1;
      r.at = Date.now();
      wrong[w] = r;
      write(K_WRONG, wrong);
    },
    removeWrong: function (w) {
      if (wrong[w]) { delete wrong[w]; write(K_WRONG, wrong); }
    },
    isWrong: function (w) { return !!wrong[w]; },
    getWrong: function () { return wrong; },
    clearWrong: function () { wrong = {}; write(K_WRONG, wrong); },
    wrongCount: function () { return Object.keys(wrong).length; },

    // ---- 收藏 ----
    isFav: function (w) { return !!fav[w]; },
    addFav: function (w) {
      fav[w] = Date.now();
      write(K_FAV, fav);
    },
    removeFav: function (w) {
      if (fav[w]) { delete fav[w]; write(K_FAV, fav); }
    },
    toggleFav: function (w) {
      if (fav[w]) { delete fav[w]; write(K_FAV, fav); return false; }
      fav[w] = Date.now(); write(K_FAV, fav); return true;
    },
    getFav: function () { return fav; },
    favCount: function () { return Object.keys(fav).length; }
  };
})();
