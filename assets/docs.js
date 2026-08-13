// Docs interactivity: search, copy buttons, language tabs.
//
// Every one of these is an enhancement layered onto HTML that already works.
// With JS off you get the full prose, all code samples (every language, all
// tabs expanded), and working navigation — you just lose the search modal and
// the copy shortcut. Nothing here is load-bearing for reading the docs.
//
// No dependencies, no build step, no framework. The whole file is smaller than
// a single analytics beacon.
;(function () {
  'use strict'

  /* ---------------------------------------------------------------- copy */

  function flash(btn, text) {
    var original = btn.textContent
    btn.textContent = text
    btn.classList.add('copied')
    setTimeout(function () {
      btn.textContent = original
      btn.classList.remove('copied')
    }, 1400)
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
    // Fallback for non-secure contexts, where the async API is unavailable.
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy') ? resolve() : reject()
      } catch (e) {
        reject(e)
      }
      document.body.removeChild(ta)
    })
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy')
    if (!btn) return
    copy(btn.getAttribute('data-code')).then(
      function () {
        flash(btn, 'Copied')
      },
      function () {
        flash(btn, 'Press ⌘C')
      },
    )
  })

  /* ------------------------------------------------------------ lang tabs */

  // Tab choice is a property of the reader, not the page: someone who picked
  // Python on the quickstart wants Python on every other page too, and still
  // wants it tomorrow.
  var LANG_KEY = 'runbrowser-docs-lang'

  function selectLang(lang, persist) {
    document.querySelectorAll('.tabs').forEach(function (group) {
      var match = group.querySelector('.tab-btn[data-lang="' + CSS.escape(lang) + '"]')
      if (!match) return // this group doesn't offer that language; leave it alone
      group.querySelectorAll('.tab-btn').forEach(function (b) {
        b.classList.toggle('active', b === match)
        b.setAttribute('aria-selected', b === match ? 'true' : 'false')
      })
      var shown = null
      group.querySelectorAll('.tab-panel').forEach(function (p) {
        p.hidden = p.getAttribute('data-lang') !== lang
        if (!p.hidden) shown = p
      })
      // The bar's copy button follows whichever panel is now showing.
      var btn = group.querySelector('.tabs-copy')
      if (btn && shown) btn.setAttribute('data-code', shown.getAttribute('data-code'))
    })
    if (persist) {
      try {
        localStorage.setItem(LANG_KEY, lang)
      } catch (e) {
        /* private browsing; the choice just won't persist */
      }
    }
  }

  function initTabs() {
    var groups = document.querySelectorAll('.tabs')
    if (!groups.length) return
    // Panels start visible so the no-JS reader sees every language. Collapsing
    // them is the first thing JS does.
    groups.forEach(function (group) {
      group.classList.add('js')
      group.querySelectorAll('.tab-panel').forEach(function (p, i) {
        p.hidden = i !== 0
      })
      group.querySelectorAll('.tab-btn').forEach(function (b, i) {
        b.classList.toggle('active', i === 0)
        b.setAttribute('aria-selected', i === 0 ? 'true' : 'false')
      })
    })
    var saved = null
    try {
      saved = localStorage.getItem(LANG_KEY)
    } catch (e) {
      /* ignore */
    }
    if (saved) selectLang(saved, false)

    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn')
      if (!btn) return
      selectLang(btn.getAttribute('data-lang'), true)
    })
  }

  /* --------------------------------------------------------------- search */

  var modal = document.getElementById('search-modal')
  var input = document.getElementById('search-input')
  var results = document.getElementById('search-results')
  var openBtn = document.getElementById('search-open')
  var index = null
  var loading = false
  var active = -1

  function loadIndex() {
    if (index || loading) return
    loading = true
    fetch('/docs/search-index.json')
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        index = data
        if (input && input.value) render(input.value)
      })
      .catch(function () {
        loading = false
        if (results) results.innerHTML = '<div class="search-empty">Search is unavailable right now.</div>'
      })
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  // Scored rather than plain substring: a query matching a heading should beat
  // one buried in body text, and matching every term should beat matching one.
  function score(entry, terms) {
    var heading = entry.h.toLowerCase()
    var title = entry.t.toLowerCase()
    var body = entry.b.toLowerCase()
    var total = 0
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i]
      var s = 0
      if (heading === t) s = 100
      else if (heading.indexOf(t) === 0) s = 60
      else if (heading.indexOf(t) !== -1) s = 40
      else if (title.indexOf(t) !== -1) s = 15
      if (body.indexOf(t) !== -1) s += 10
      if (s === 0) return 0 // every term must appear somewhere
      total += s
    }
    // Canonical pages outrank comparison pages on an otherwise equal match.
    return total * (entry.w || 1)
  }

  function snippet(text, term) {
    var i = text.toLowerCase().indexOf(term)
    if (i === -1) return text.slice(0, 110) + (text.length > 110 ? '…' : '')
    var start = Math.max(0, i - 40)
    var raw = (start ? '…' : '') + text.slice(start, start + 130) + '…'
    // Highlight after escaping, so the match markup is the only markup.
    return escapeHtml(raw).replace(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>')
  }

  function render(query) {
    if (!results) return
    var q = query.trim().toLowerCase()
    if (!q) {
      results.innerHTML = '<div class="search-empty">Try <code>concurrency</code>, <code>429</code>, or <code>keepAlive</code>.</div>'
      return
    }
    if (!index) {
      results.innerHTML = '<div class="search-empty">Loading…</div>'
      return
    }
    var terms = q.split(/\s+/)
    var hits = []
    for (var i = 0; i < index.length; i++) {
      var s = score(index[i], terms)
      if (s > 0) hits.push({ e: index[i], s: s })
    }
    hits.sort(function (a, b) {
      return b.s - a.s
    })
    hits = hits.slice(0, 12)

    if (!hits.length) {
      results.innerHTML =
        '<div class="search-empty">No match for <strong>' +
        escapeHtml(query) +
        "</strong>. If you expected one, that's a docs bug — " +
        '<a href="mailto:hi@runbrowser.dev?subject=Docs%20search%3A%20' +
        encodeURIComponent(query) +
        '">tell us</a>.</div>'
      return
    }
    active = 0
    results.innerHTML = hits
      .map(function (h, i) {
        var e = h.e
        var href = '/docs/' + e.p + (e.s ? '#' + e.s : '')
        return (
          '<a class="search-hit' +
          (i === 0 ? ' active' : '') +
          '" href="' +
          href +
          '">' +
          '<span class="hit-page">' +
          escapeHtml(e.t) +
          '</span>' +
          '<span class="hit-heading">' +
          escapeHtml(e.h) +
          '</span>' +
          '<span class="hit-body">' +
          snippet(e.b, terms[0]) +
          '</span>' +
          '</a>'
        )
      })
      .join('')
  }

  function move(delta) {
    var hits = results.querySelectorAll('.search-hit')
    if (!hits.length) return
    active = (active + delta + hits.length) % hits.length
    hits.forEach(function (h, i) {
      h.classList.toggle('active', i === active)
    })
    hits[active].scrollIntoView({ block: 'nearest' })
  }

  function openSearch() {
    if (!modal) return
    loadIndex()
    modal.hidden = false
    document.body.style.overflow = 'hidden'
    input.value = ''
    render('')
    input.focus()
  }

  function closeSearch() {
    if (!modal) return
    modal.hidden = true
    document.body.style.overflow = ''
  }

  if (openBtn) openBtn.addEventListener('click', openSearch)
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeSearch()
    })
    // Warm the index on intent, so the first keystroke has data behind it.
    if (openBtn) openBtn.addEventListener('mouseenter', loadIndex)
    input.addEventListener('input', function () {
      render(input.value)
    })
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        move(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        move(-1)
      } else if (e.key === 'Enter') {
        var hit = results.querySelector('.search-hit.active')
        if (hit) {
          e.preventDefault()
          window.location.href = hit.getAttribute('href')
        }
      } else if (e.key === 'Escape') {
        closeSearch()
      }
    })
  }

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      modal && modal.hidden ? openSearch() : closeSearch()
    } else if (e.key === '/' && !typing && modal && modal.hidden) {
      e.preventDefault()
      openSearch()
    } else if (e.key === 'Escape' && modal && !modal.hidden) {
      closeSearch()
    }
  })

  // On a Mac the shortcut hint should say ⌘K, not the Linux/Windows Ctrl K.
  if (/Mac|iPhone|iPad/.test(navigator.platform || '')) {
    document.querySelectorAll('.kbd-mod').forEach(function (el) {
      el.textContent = '⌘'
    })
  }

  initTabs()
})()
