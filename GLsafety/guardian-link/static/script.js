document.addEventListener('DOMContentLoaded', function () {

  // ── 1. Eye Toggle for Password Fields ──────────────────────────
  document.querySelectorAll('input[type="password"]').forEach(function (input) {
    // Only wrap if not already inside input-group
    const parent = input.parentNode;
    const isInGroup = parent.classList.contains('input-group');

    if (isInGroup) {
      // Place eye inside input-group after input
      const eye = makeEyeBtn();
      const span = document.createElement('span');
      span.classList.add('input-group-text', 'p-0');
      span.style.cssText = 'background:#0b0f1d!important;border:1px solid rgba(255,255,255,0.12)!important;';
      span.appendChild(eye);
      parent.appendChild(span);
      eye.addEventListener('click', () => toggleEye(input, eye));
    } else {
      const wrapper = document.createElement('div');
      wrapper.classList.add('password-wrapper');
      parent.insertBefore(wrapper, input);
      wrapper.appendChild(input);
      const eye = makeEyeBtn();
      wrapper.appendChild(eye);
      eye.addEventListener('click', () => toggleEye(input, eye));
    }

    // ── 2. Password Strength Meter ────────────────────────────────
    const strengthWrap = document.createElement('div');
    strengthWrap.classList.add('strength-bar-wrap');
    const bar = document.createElement('div');
    bar.classList.add('strength-bar');
    strengthWrap.appendChild(bar);
    const label = document.createElement('div');
    label.classList.add('strength-label');

    const container = input.closest('.password-wrapper') || input.closest('.input-group') || input.parentNode;
    container.insertAdjacentElement('afterend', label);
    container.insertAdjacentElement('afterend', strengthWrap);

    input.addEventListener('input', function () {
      const result = checkStrength(input.value);
      bar.style.width     = result.width;
      bar.style.background = result.color;
      label.textContent   = input.value.length ? result.text : '';
      label.style.color   = result.color;
    });
  });

  function makeEyeBtn() {
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.classList.add('eye-toggle');
    eye.innerHTML = '<i class="bi bi-eye"></i>';
    return eye;
  }

  function toggleEye(input, eye) {
    if (input.type === 'password') {
      input.type = 'text';
      eye.innerHTML = '<i class="bi bi-eye-slash"></i>';
      eye.style.opacity = '1';
    } else {
      input.type = 'password';
      eye.innerHTML = '<i class="bi bi-eye"></i>';
      eye.style.opacity = '0.6';
    }
  }

  function checkStrength(pw) {
    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 1) return { width: '20%',  color: '#ff5c7a', text: '😟 Too Weak' };
    if (score === 2) return { width: '45%',  color: '#ffcf5a', text: '😐 Weak' };
    if (score === 3) return { width: '70%',  color: '#4c7dff', text: '🙂 Medium' };
    return              { width: '100%', color: '#1ee6a8', text: '💪 Strong' };
  }

  // ── 3. Dark / Light Mode Toggle ────────────────────────────────
  const themeBtn = document.getElementById('themeToggleBtn');
  const body     = document.body;

  function applyTheme(mode) {
    if (mode === 'light') {
      body.classList.add('light-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="bi bi-sun-fill"></i> Light';
    } else {
      body.classList.remove('light-mode');
      if (themeBtn) themeBtn.innerHTML = '<i class="bi bi-moon-stars-fill"></i> Dark';
    }
  }

  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      const isLight = body.classList.contains('light-mode');
      const next = isLight ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      applyTheme(next);
    });
  }

  // ── 4. Search / Filter Incidents ───────────────────────────────
  const searchInput = document.getElementById('incidentSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      const query = this.value.toLowerCase().trim();
      const items = document.querySelectorAll('.searchable-incident');
      let visible = 0;

      items.forEach(function (item) {
        const text = item.getAttribute('data-search') || '';
        if (text.includes(query)) {
          item.style.display = '';
          visible++;
        } else {
          item.style.display = 'none';
        }
      });

      const noMsg = document.getElementById('noResultsMsg');
      if (noMsg) noMsg.style.display = visible === 0 ? 'block' : 'none';
    });
  }

  // ── 5. Lightbox for Evidence Images ────────────────────────────
  const overlay = document.createElement('div');
  overlay.classList.add('lightbox-overlay');
  overlay.innerHTML = `
    <button class="lightbox-close" id="lightboxClose">&times;</button>
    <img class="lightbox-img" id="lightboxImg" src="" alt="Evidence">
  `;
  document.body.appendChild(overlay);

  document.querySelectorAll('.evidence-thumb').forEach(function (img) {
    img.addEventListener('click', function () {
      document.getElementById('lightboxImg').src = img.src;
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });

  function closeLightbox() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  // ── Copy Buttons ───────────────────────────────────────────────
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const text = btn.getAttribute('data-copy');
      if (!text) return;
      navigator.clipboard.writeText(text).then(function () {
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Copied!';
        setTimeout(function () { btn.innerHTML = original; }, 2000);
      });
    });
  });

  // ── Typewriter Effect ──────────────────────────────────────────
  const el = document.getElementById('typewriterText');
  if (el) {
    const words = ['AI Detection', 'Real-time Alerts', 'Evidence Vault', 'Parent Control'];
    let wi = 0, ci = 0, deleting = false;

    function type() {
      const word = words[wi];
      el.textContent = deleting ? word.substring(0, ci--) : word.substring(0, ci++);

      if (!deleting && ci === word.length + 1) {
        deleting = true;
        setTimeout(type, 1400);
      } else if (deleting && ci === 0) {
        deleting = false;
        wi = (wi + 1) % words.length;
        setTimeout(type, 400);
      } else {
        setTimeout(type, deleting ? 60 : 100);
      }
    }
    type();
  }

});