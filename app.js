/* 离线英汉词典 · 主逻辑
   数据：window.DICT_DATA = [[word, phonetic, pos, def_zh, def_en, forms, lvl], ...] */
(function () {
  'use strict';

  // ======================= 词库索引 =======================
  var RAW = window.DICT_DATA || [];
  var INDEX = Object.create(null);   // word -> {p,pos,zh,en,fm,lvl}
  for (var i = 0; i < RAW.length; i++) {
    var r = RAW[i];
    INDEX[r[0]] = { p: r[1] || '', pos: r[2] || '', zh: r[3] || '', en: r[4] || '', fm: r[5] || '', lvl: r[6] || 0 };
  }
  var KEYS = Object.keys(INDEX);

  // ======================= 工具 =======================
  function $(s) { return document.querySelector(s); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function firstLine(s) { return String(s || '').split('\n')[0].trim(); }
  function esc(s) { return String(s == null ? '' : s); }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1700);
  }

  // 取词条：自定义优先，其次词库
  function lookup(word) {
    var w = norm(word);
    if (!w) return null;
    var custom = Store.getEntry(w);
    if (custom) {
      return {
        word: w, phonetic: custom.phonetic || '', pos: custom.pos || '',
        def_zh: custom.def_zh || '', def_en: custom.def_en || '',
        forms: custom.forms || '', colloc: custom.colloc || '',
        example: custom.example || '', custom: true
      };
    }
    var d = INDEX[w];
    if (d) {
      return {
        word: w, phonetic: d.p, pos: d.pos, def_zh: d.zh, def_en: d.en,
        forms: d.fm, colloc: '', example: '', custom: false, lvl: d.lvl
      };
    }
    return null;
  }

  // ======================= 页签切换 =======================
  var currentTab = 'look';
  var tabs = document.querySelectorAll('.tab');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function () {
      var name = this.getAttribute('data-tab');
      switchTab(name);
    });
  }
  function switchTab(name) {
    currentTab = name;
    var all = document.querySelectorAll('.tab');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('active', all[i].getAttribute('data-tab') === name);
    }
    var pages = document.querySelectorAll('.page');
    for (var j = 0; j < pages.length; j++) {
      pages[j].classList.toggle('active', pages[j].id === 'page-' + name);
    }
    if (name === 'wrong') renderWrong();
    if (name === 'fav') renderFav();
    if (name === 'quiz' && !Quiz.current) { /* 等用户选范围 */ }
    window.scrollTo(0, 0);
  }

  // ======================= 查词 =======================
  var lookInput = $('#lookInput');
  var lookBtn = $('#lookBtn');
  var lookSuggest = $('#lookSuggest');
  var lookResult = $('#lookResult');

  function suggestFor(q) {
    var w = norm(q);
    if (!w) return [];
    var out = [];
    var starts = [], contains = [];
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (k === w) continue;
      if (k.indexOf(w) === 0) { if (starts.length < 8) starts.push(k); }
      else if (k.indexOf(w) > 0) { if (contains.length < 8) contains.push(k); }
      if (starts.length >= 8) break;
    }
    out = starts.concat(contains);
    // 去重
    var seen = {}, res = [];
    for (var j = 0; j < out.length; j++) {
      if (!seen[out[j]]) { seen[out[j]] = 1; res.push(out[j]); }
    }
    return res.slice(0, 10);
  }

  // ======================= 中文反查索引 =======================
  var ZH_INDEX = null;   // 中文词 -> [英文单词...]

  function extractZhTerms(zh) {
    var out = [];
    var POS_RE = /^(vt|vi|n|a|ad|adv|prep|conj|pron|num|int|art|aux|abbr)\.\s*/i;
    var lines = String(zh || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\[[^\]]*\]\s*/, '').replace(POS_RE, '');
      var parts = line.split(/[,，;；、\/]/);
      for (var j = 0; j < parts.length; j++) {
        var t = parts[j].trim()
          .replace(/^\(.*?\)\s*/, '')
          .replace(/\s*\(.*?\)$/, '');
        if (!t || t.length > 12) continue;
        if (/^[a-z\s]+$/i.test(t)) continue;   // 纯英文跳过
        out.push(t);
      }
    }
    return out;
  }

  function buildZhIndex() {
    if (ZH_INDEX) return ZH_INDEX;
    ZH_INDEX = Object.create(null);
    for (var i = 0; i < KEYS.length; i++) {
      var w = KEYS[i];
      var e = INDEX[w];
      if (!e || !e.zh) continue;
      var seen = Object.create(null);
      var terms = extractZhTerms(e.zh);
      for (var j = 0; j < terms.length; j++) {
        var t = terms[j];
        if (seen[t]) continue;
        seen[t] = 1;
        (ZH_INDEX[t] || (ZH_INDEX[t] = [])).push(w);
      }
    }
    return ZH_INDEX;
  }

  // 中文模糊查：精确 > 前缀 > 包含
  function lookupChinese(q) {
    var query = String(q || '').trim();
    if (!query) return [];
    var idx = buildZhIndex();
    var exact = [], starts = [], contains = [];
    for (var k in idx) {
      if (k === query) exact.push(k);
      else if (k.indexOf(query) === 0) starts.push(k);
      else if (k.indexOf(query) > 0) contains.push(k);
    }
    var out = [], seen = Object.create(null);
    var order = exact.concat(starts, contains);
    for (var i = 0; i < order.length; i++) {
      var words = idx[order[i]];
      for (var j = 0; j < words.length && out.length < 60; j++) {
        if (seen[words[j]]) continue;
        seen[words[j]] = 1;
        out.push(words[j]);
      }
    }
    return out;
  }

  function hasChinese(str) {
    return /[\u4e00-\u9fa5]/.test(String(str || ''));
  }

  function doLook(q) {
    var raw = String(q == null ? '' : q).trim();
    if (!raw) { toast('输入英文单词或中文意思'); return; }
    lookSuggest.innerHTML = '';
    lookResult.innerHTML = '';

    // 含中文 → 中文反查
    if (hasChinese(raw)) {
      var words = lookupChinese(raw);
      if (!words.length) {
        lookResult.appendChild(el('div', 'errbox', '没找到含「' + raw + '」的词'));
        return;
      }
      lookResult.appendChild(el('div', 'cnt', '「' + raw + '」相关 ' + words.length + ' 个词，点开查看：'));
      words.forEach(function (w) {
        var ee = lookup(w);
        var def = ee ? (firstLine(ee.def_zh) || firstLine(ee.def_en)) : '';
        // 若释义太长，只留第一条
        var card = el('div', 'zhcard');
        var left = el('div', 'zhleft');
        left.appendChild(el('div', 'zhword', w));
        left.appendChild(el('div', 'zhdef', def));
        card.appendChild(left);
        card.addEventListener('click', function () {
          lookInput.value = w;
          doLook(w);
        });
        lookResult.appendChild(card);
      });
      return;
    }

    var word = norm(raw);
    var e = lookup(word);
    if (!e) {
      var box = el('div', 'errbox', '词库里没有「' + q + '」');
      lookResult.appendChild(box);
      var sug = suggestFor(q);
      if (sug.length) {
        var hint = el('div', 'cnt', '你是不是想找：');
        lookResult.appendChild(hint);
        var wrap = el('div', 'suggest');
        sug.forEach(function (s) {
          var c = el('button', 'chip', s);
          c.addEventListener('click', function () {
            lookInput.value = s;
            doLook(s);
          });
          wrap.appendChild(c);
        });
        lookResult.appendChild(wrap);
      }
      return;
    }
    renderEntry(e);
  }

  function renderEntry(e) {
    var head = el('div', 'wordhead');
    head.appendChild(el('h2', null, e.word));
    if (e.phonetic) {
      var ph = String(e.phonetic).replace(/^\/|\/$/g, '');
      head.appendChild(el('span', 'phon', '/' + ph + '/'));
    }

    // 收藏按钮
    var isFav = Store.isFav(e.word);
    var favBtn = el('button', 'favbtn' + (isFav ? ' on' : ''), isFav ? '★ 已收藏' : '☆ 收藏');
    favBtn.addEventListener('click', function () {
      var now = Store.toggleFav(e.word);
      favBtn.className = 'favbtn' + (now ? ' on' : '');
      favBtn.textContent = now ? '★ 已收藏' : '☆ 收藏';
      toast(now ? '已加入收藏' : '已取消收藏');
    });
    head.appendChild(favBtn);
    lookResult.appendChild(head);

    function field(k, v, cls) {
      if (!v) return;
      var f = el('div', 'field');
      f.appendChild(el('div', 'k', k));
      f.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), v));
      lookResult.appendChild(f);
    }
    field('词性', e.pos, 'pos');
    field('中文释义', e.def_zh);
    field('英英释义', e.def_en);
    field('词形变化', e.forms);
    field('搭配', e.colloc);
    field('例句', e.example);

    if (e.custom) {
      var tag = el('span', 'tag', '含你自定义的内容');
      lookResult.appendChild(tag);
    }
  }

  lookBtn.addEventListener('click', function () { doLook(lookInput.value); });
  lookInput.addEventListener('input', function () {
    var q = lookInput.value;
    var sug = suggestFor(q);
    lookSuggest.innerHTML = '';
    if (!q || sug.length === 0) return;
    sug.slice(0, 6).forEach(function (s) {
      var c = el('button', 'chip', s);
      c.addEventListener('click', function () {
        lookInput.value = s;
        lookSuggest.innerHTML = '';
        doLook(s);
      });
      lookSuggest.appendChild(c);
    });
  });
  lookInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { doLook(lookInput.value); lookInput.blur(); }
  });

  // ======================= 出题池 =======================
  var POOL = null;
  function buildPool() {
    if (POOL) return POOL;
    var core = [], all = [], byPos = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (k.length < 3) continue;
      if (/[’']/.test(k)) continue;
      if (!/^[a-z][a-z -]*$/.test(k)) continue;
      var e = INDEX[k];
      if (!e.zh) continue;
      if (/城市|地名|人名|美国|英国|法国|德国|州$/.test(e.zh)) continue;
      var zh1 = firstLine(e.zh);
      if (zh1.length < 2) continue;
      var item = { key: k, e: e };
      all.push(item);
      if (e.lvl >= 2) core.push(item);
      var p = (e.pos || '').split('、')[0];
      if (p) { (byPos[p] || (byPos[p] = [])).push(item); }
    }
    POOL = { core: core, all: all, byPos: byPos };
    return POOL;
  }

  function similar(a, b) {
    if (!a || !b) return false;
    if (Math.abs(a.length - b.length) > 2) return false;
    var n = Math.min(a.length, b.length), same = 0;
    for (var i = 0; i < n; i++) if (a[i] === b[i]) same++;
    return same >= n - 1;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ======================= 背词 =======================
  var Quiz = {
    dir: 'en2zh',
    scope: 'core',
    current: null
  };

  function makeQuestion() {
    var pool = buildPool();
    var src;
    if (Quiz.scope === 'wrong') {
      var wr = Store.getWrong();
      src = pool.all.filter(function (x) { return wr[x.key]; });
      if (!src.length) { toast('错题本是空的'); return null; }
    } else if (Quiz.scope === 'fav') {
      var fv = Store.getFav();
      // 出题只用收藏词
      src = pool.all.filter(function (x) { return fv[x.key]; });
      if (src.length < 1) { toast('还没有收藏的单词'); return null; }
    } else if (Quiz.scope === 'core') {
      src = pool.core.length >= 50 ? pool.core : pool.all;
    } else {
      src = pool.all;
    }
    if (!src.length) { toast('没有可用的词'); return null; }

    var seed = src[Math.floor(Math.random() * src.length)];
    var key = seed.key, e = seed.e;
    var zh1 = firstLine(e.zh) || firstLine(e.en) || key;
    var en = key;

    var prompt = Quiz.dir === 'en2zh' ? en : zh1;
    var answer = Quiz.dir === 'en2zh' ? zh1 : en;

    // 干扰项从"全体词"里取（收藏/错题范围下也能凑够 4 个选项）
    var posKey = (e.pos || '').split('、')[0];
    var samePos = (pool.byPos[posKey] || []).filter(function (x) { return x.key !== key; });
    var sim = pool.all.filter(function (x) { return x.key !== key && similar(key, x.key); });
    var rest = pool.all.filter(function (x) { return x.key !== key; });
    var cands = shuffle(samePos.slice()).concat(shuffle(sim.slice())).concat(shuffle(rest.slice()));

    var opts = [{ label: answer, value: 'c', key: key }];
    var seen = {}; seen[answer] = 1;
    for (var i = 0; i < cands.length && opts.length < 4; i++) {
      var c = cands[i];
      var label = Quiz.dir === 'en2zh'
        ? (firstLine(c.e.zh) || firstLine(c.e.en) || c.key)
        : c.key;
      if (!label || seen[label]) continue;
      seen[label] = 1;
      opts.push({ label: label, value: c.key, key: c.key });
    }
    if (opts.length < 4) { toast('凑不够选项，换个范围'); return null; }

    return {
      key: key, prompt: prompt, opts: shuffle(opts),
      answered: false, picked: null, correct: null
    };
  }

  var quizBody = $('#quizBody');

  function renderQuiz() {
    var q = Quiz.current;
    quizBody.innerHTML = '';
    if (!q) {
      quizBody.appendChild(el('div', 'empty', '选好方向和范围，点「开始」'));
      var b = el('button', 'btn primary', '开始');
      b.style.width = '100%';
      b.addEventListener('click', startQuiz);
      quizBody.appendChild(b);
      return;
    }

    quizBody.appendChild(el('div', 'qprompt',
      Quiz.dir === 'en2zh' ? '这个词的中文意思是？' : '这个意思对应的英文单词是？'));
    var qw = el('div', 'qword' + (Quiz.dir === 'zh2en' ? ' zh' : ''), q.prompt);
    quizBody.appendChild(qw);

    var wrap = el('div', 'opts');
    q.opts.forEach(function (o, idx) {
      var isCorrect = o.value === 'c';
      var isPicked = o.value === q.picked;
      var cls = 'opt';
      var mark = '';
      if (q.answered) {
        if (isCorrect) { cls += ' correct'; mark = '✓'; }
        else if (isPicked) { cls += ' wrong'; mark = '✗'; }
      }
      var btn = el('button', cls);
      btn.setAttribute('data-idx', idx);
      if (q.answered) btn.disabled = true;
      var m = el('span', 'mark', mark);
      var lbl = el('span', null, o.label);
      btn.appendChild(m);
      btn.appendChild(lbl);
      if (!q.answered) {
        btn.addEventListener('click', function () { answerQuestion(idx); });
      }
      wrap.appendChild(btn);
    });
    quizBody.appendChild(wrap);

    if (q.answered) {
      var v = el('div', 'verdict ' + (q.correct ? 'good' : 'bad'),
        q.correct ? '答对了' : '答错了');
      quizBody.appendChild(v);

      var e = lookup(q.key);
      if (e) {
        var rev = el('div', 'reveal');
        function rf(k, val, cls) {
          if (!val) return;
          var f = el('div', 'field');
          f.appendChild(el('div', 'k', k));
          f.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), val));
          rev.appendChild(f);
        }
        rf('中文释义', e.def_zh);
        rf('英英释义', e.def_en);
        rf('词形变化', e.forms);
        rf('例句', e.example);
        quizBody.appendChild(rev);
      }

      var btns = el('div', 'rowbtns');
      var next = el('button', 'btn primary', '下一题');
      next.addEventListener('click', function () {
        Quiz.current = makeQuestion();
        renderQuiz();
      });
      btns.appendChild(next);
      quizBody.appendChild(btns);
    } else {
      var btns2 = el('div', 'rowbtns');
      var skip = el('button', 'btn', '跳过');
      skip.addEventListener('click', function () {
        Quiz.current = makeQuestion();
        renderQuiz();
      });
      btns2.appendChild(skip);
      quizBody.appendChild(btns2);
    }
  }

  function answerQuestion(idx) {
    var q = Quiz.current;
    if (!q || q.answered) return;
    var picked = q.opts[idx];
    q.answered = true;
    q.picked = picked.value;
    q.correct = picked.value === 'c';
    if (q.correct) Store.removeWrong(q.key);
    else Store.addWrong(q.key);
    renderQuiz();
  }

  function startQuiz() {
    Quiz.current = makeQuestion();
    renderQuiz();
  }

  // 方向 / 范围按钮
  var dirSeg = $('#dirSeg');
  dirSeg.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.segbtn');
    if (!btn) return;
    Quiz.dir = btn.getAttribute('data-dir');
    var bs = dirSeg.querySelectorAll('.segbtn');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i] === btn);
    Quiz.current = makeQuestion();
    renderQuiz();
  });

  var scopeSeg = $('#scopeSeg');
  scopeSeg.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.segbtn');
    if (!btn) return;
    Quiz.scope = btn.getAttribute('data-scope');
    var bs = scopeSeg.querySelectorAll('.segbtn');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i] === btn);
    Quiz.current = makeQuestion();
    renderQuiz();
  });

  // ======================= 收藏 =======================
  var favBody = $('#favBody');

  function renderFav() {
    favBody.innerHTML = '';
    var fv = Store.getFav();
    var keys = Object.keys(fv);
    if (!keys.length) {
      favBody.appendChild(el('div', 'empty', '还没有收藏。查词时点「☆ 收藏」，词就会出现在这里。'));
      return;
    }
    // 按收藏时间倒序（新的在前）
    keys.sort(function (a, b) { return (fv[b] || 0) - (fv[a] || 0); });

    favBody.appendChild(el('div', 'cnt', '共 ' + keys.length + ' 个收藏'));

    var list = el('div', 'favlist');
    keys.forEach(function (k) {
      var e = lookup(k);
      var row = el('div', 'favrow');

      var main = el('div', 'favmain');
      main.appendChild(el('div', 'favword', k));
      main.appendChild(el('div', 'favdef', e ? (firstLine(e.def_zh) || firstLine(e.def_en) || '') : '（查不到）'));
      row.appendChild(main);

      var del = el('button', 'favdel', '✕');
      del.setAttribute('aria-label', '取消收藏');
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        Store.removeFav(k);
        renderFav();
        toast('已取消收藏');
      });
      row.appendChild(del);

      main.addEventListener('click', function () {
        switchTab('look');
        lookInput.value = k;
        doLook(k);
      });

      list.appendChild(row);
    });
    favBody.appendChild(list);

    var btns = el('div', 'rowbtns');
    var practice = el('button', 'btn primary', '背这些收藏词');
    practice.addEventListener('click', function () {
      Quiz.scope = 'fav';
      var bs = scopeSeg.querySelectorAll('.segbtn');
      for (var i = 0; i < bs.length; i++) {
        bs[i].classList.toggle('active', bs[i].getAttribute('data-scope') === 'fav');
      }
      switchTab('quiz');
      Quiz.current = makeQuestion();
      renderQuiz();
    });
    btns.appendChild(practice);
    favBody.appendChild(btns);
  }

  // ======================= 错题本 =======================
  var wrongBody = $('#wrongBody');

  function renderWrong() {
    wrongBody.innerHTML = '';
    var wr = Store.getWrong();
    var keys = Object.keys(wr);
    if (!keys.length) {
      wrongBody.appendChild(el('div', 'empty', '还没有错题。去背几题，答错的会出现在这里。'));
      return;
    }
    keys.sort(function (a, b) { return (wr[b].n || 0) - (wr[a].n || 0); });

    wrongBody.appendChild(el('div', 'cnt', '共 ' + keys.length + ' 个错题，答对会自动移除'));

    var table = el('table', 'wtable');
    var thead = el('thead');
    var tr = el('tr');
    ['单词', '释义', '错次'].forEach(function (h) { tr.appendChild(el('th', null, h)); });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = el('tbody');
    keys.slice(0, 200).forEach(function (k) {
      var e = lookup(k);
      var row = el('tr');
      row.appendChild(el('td', null, k));
      row.appendChild(el('td', null, e ? firstLine(e.def_zh) || firstLine(e.def_en) || '—' : '（查不到）'));
      row.appendChild(el('td', null, String((wr[k] && wr[k].n) || 1)));
      row.addEventListener('click', function () {
        switchTab('look');
        lookInput.value = k;
        doLook(k);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrongBody.appendChild(table);

    var btns = el('div', 'rowbtns');
    var practice = el('button', 'btn primary', '练这些错题');
    practice.addEventListener('click', function () {
      Quiz.scope = 'wrong';
      var bs = scopeSeg.querySelectorAll('.segbtn');
      for (var i = 0; i < bs.length; i++) {
        bs[i].classList.toggle('active', bs[i].getAttribute('data-scope') === 'wrong');
      }
      switchTab('quiz');
      Quiz.current = makeQuestion();
      renderQuiz();
    });
    var clr = el('button', 'btn', '清空');
    clr.addEventListener('click', function () {
      if (confirm('确定清空错题本？')) {
        Store.clearWrong();
        renderWrong();
        toast('错题本已清空');
      }
    });
    btns.appendChild(practice);
    btns.appendChild(clr);
    wrongBody.appendChild(btns);
  }

  // ======================= 编辑 =======================
  var editInput = $('#editInput');
  var editLoadBtn = $('#editLoadBtn');
  var editBody = $('#editBody');
  var editState = null;

  var FIELDS = [
    ['phonetic', '国际音标'],
    ['pos', '词性'],
    ['def_zh', '中文释义'],
    ['def_en', '英英释义'],
    ['forms', '词形变化'],
    ['colloc', '搭配'],
    ['example', '例句']
  ];

  function renderEdit() {
    editBody.innerHTML = '';
    if (!editState) {
      editBody.appendChild(el('div', 'empty', '输入单词后点「载入」开始编辑'));
      return;
    }
    var word = editState.word;
    var exists = !!lookup(word);
    editBody.appendChild(el('div', 'cnt', word + (exists ? '（已存在，修改会覆盖词库内容）' : '（新词，保存后会加入你的词库）')));

    FIELDS.forEach(function (f) {
      var key = f[0], label = f[1];
      var row = el('div', 'formrow');
      var lab = el('label', null, label);
      var input;
      if (key === 'def_zh' || key === 'def_en' || key === 'example' || key === 'colloc' || key === 'forms') {
        input = el('textarea');
      } else {
        input = el('input');
        input.type = 'text';
      }
      input.value = editState.data[key] || '';
      input.addEventListener('input', function () { editState.data[key] = input.value; });
      row.appendChild(lab);
      row.appendChild(input);
      editBody.appendChild(row);
    });

    var btns = el('div', 'rowbtns');
    var save = el('button', 'btn primary', '保存');
    save.addEventListener('click', function () {
      var obj = {};
      FIELDS.forEach(function (f) { obj[f[0]] = editState.data[f[0]] || ''; });
      Store.setEntry(word, obj);
      toast('已保存「' + word + '」');
    });
    btns.appendChild(save);

    if (Store.getEntry(word)) {
      var del = el('button', 'btn', '删除自定义');
      del.addEventListener('click', function () {
        if (confirm('删除对「' + word + '」的自定义内容？')) {
          Store.delEntry(word);
          toast('已删除自定义内容');
          loadEdit(word);
        }
      });
      btns.appendChild(del);
    }
    editBody.appendChild(btns);
  }

  function loadEdit(word) {
    var w = norm(word);
    if (!w) { toast('请输入单词'); return; }
    var e = lookup(w);
    editState = {
      word: w,
      data: e ? {
        phonetic: e.phonetic || '', pos: e.pos || '',
        def_zh: e.def_zh || '', def_en: e.def_en || '',
        forms: e.forms || '', colloc: e.colloc || '', example: e.example || ''
      } : { phonetic: '', pos: '', def_zh: '', def_en: '', forms: '', colloc: '', example: '' }
    };
    renderEdit();
  }

  editLoadBtn.addEventListener('click', function () { loadEdit(editInput.value); });
  editInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { loadEdit(editInput.value); editInput.blur(); }
  });

  // ======================= 启动 =======================
  renderQuiz();
  renderEdit();
  // 预建池（首次背词会快些）
  setTimeout(function () { try { buildPool(); } catch (e) {} }, 300);

  window.DictApp = { lookup: lookup, count: KEYS.length, INDEX: INDEX, KEYS: KEYS };
  console.log('词典就绪，词条 ' + KEYS.length);
})();
