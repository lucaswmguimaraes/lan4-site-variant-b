/**
 * main.js — Liveblocks clone interactions
 * Replica os comportamentos do site original: dropdowns, mobile menu,
 * pointer glow, cursor animations, header scroll state.
 */

/* ─── Utils ─────────────────────────────────────────────────────────── */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ─── LAN4 Tracking Layer (GTM dataLayer) ───────────────────────────────
   Empurra eventos padronizados pro GTM: lead_form_submit (conversão),
   form_start e cta_click. user_data vai em claro e normalizado — o
   Google tag e o Meta Pixel hasheiam (SHA-256) no navegador antes de
   enviar (Enhanced Conversions / Advanced Matching). */
window.dataLayer = window.dataLayer || [];

function lan4EventId() {
  return (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function lan4NormalizeEmail(raw) {
  return (raw || '').trim().toLowerCase();
}

/* Telefone cru → só dígitos, com DDI 55 adicionado (sem formatação de plataforma) */
function lan4PhoneDigits(raw) {
  var d = (raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}
/* Google Ads Enhanced Conversions: E.164 com '+' */
function lan4NormalizePhoneGoogle(raw) {
  var d = lan4PhoneDigits(raw);
  return d ? '+' + d : '';
}
/* Meta Advanced Matching / CAPI: só dígitos, sem '+' (doc oficial da Meta) */
function lan4NormalizePhoneMeta(raw) {
  return lan4PhoneDigits(raw);
}

function lan4SplitName(nome) {
  var parts = (nome || '').trim().split(/\s+/);
  return {
    first: (parts[0] || '').toLowerCase(),
    last: (parts.length > 1 ? parts[parts.length - 1] : '').toLowerCase()
  };
}

/* Chamar APENAS no callback de sucesso do envio ao RD Station.
   eventName distingue o formulário real (lead_form_submit, alimenta a
   conversão "Lead Form" do Google Ads) dos fluxos secundários
   (WhatsApp, material isca), que usam seu próprio nome de evento para
   não contaminar essa conversão — mesmo padrão já aplicado no Meta
   Pixel (trackCustom em vez de standard Lead) para esses fluxos. */
function lan4PushLead(identificador, p, eventName) {
  var name = lan4SplitName(p.nome);
  window.dataLayer.push({
    event: eventName || 'lead_form_submit',
    form_identifier: identificador,
    event_id: lan4EventId(),
    lead: {
      company: p.empresa || '',
      cargo: p.cargo || '',
      faturamento: p.faturamento || '',
      ticket: p.ticket || ''
    },
    user_data: {
      email: lan4NormalizeEmail(p.email),
      phone: lan4NormalizePhoneGoogle(p.telefone),
      phone_meta: lan4NormalizePhoneMeta(p.telefone),
      first_name: name.first,
      last_name: name.last
    }
  });
}

/* ─── UTMs → RD Station ─────────────────────────────────────────────────
   Captura os UTMs na entrada, persiste na sessão (sobrevive à navegação
   na página) e injeta no payload da conversão do RD. O comercial recebe
   o serviço de interesse via cf_servico_interesse (derivado do
   utm_content prefixado das campanhas de Search / utm_term do Meta). */
var LAN4_UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

(function () {
  try {
    var qs = new URLSearchParams(window.location.search);
    var found = {};
    LAN4_UTM_KEYS.forEach(function (k) { var v = qs.get(k); if (v) found[k] = v; });
    if (Object.keys(found).length) sessionStorage.setItem('lan4_utms', JSON.stringify(found));
  } catch (e) { /* sessionStorage indisponível: segue sem UTMs */ }
})();

function lan4GetUtms() {
  try { return JSON.parse(sessionStorage.getItem('lan4_utms') || '{}'); }
  catch (e) { return {}; }
}

function lan4ServicoInteresse(utms) {
  var mapa = {
    vendas: 'Vendas e CRM', social: 'Gestão de Redes Sociais',
    recrut: 'Recrutamento e Seleção', midia: 'Mídia Paga',
    audio: 'Audiovisual e Conteúdo', eventos: 'Eventos Corporativos',
    mkt: 'Marketing Digital', nicho: 'Nichos', ia: 'Inteligência Artificial',
    marca: 'Marca/Institucional'
  };
  var c = (utms.utm_content || '').toLowerCase();
  for (var k in mapa) { if (c.indexOf(k) === 0) return mapa[k]; }
  /* Meta: o conjunto (serviço/nicho) viaja no utm_term ({{adset.name}}) */
  return utms.utm_term || utms.utm_content || '';
}

function lan4RdUtmPayload() {
  var u = lan4GetUtms();
  var p = {};
  if (u.utm_source)   { p.traffic_source = u.utm_source; p.cf_utm_source = u.utm_source; }
  if (u.utm_medium)   p.cf_utm_medium   = u.utm_medium;
  if (u.utm_campaign) p.cf_utm_campaign = u.utm_campaign;
  if (u.utm_term)     p.cf_utm_term     = u.utm_term;
  if (u.utm_content)  p.cf_utm_content  = u.utm_content;
  /* Em páginas de serviço (/s/<slug>/), window.LAN4_SERVICO_PAGINA garante o
     serviço de interesse mesmo em acesso sem UTM (orgânico/direto/compartilhado) */
  var servico = lan4ServicoInteresse(u) || window.LAN4_SERVICO_PAGINA || '';
  if (servico) p.cf_servico_de_interesse = servico;
  return p;
}

/* ─── Validação de telefone (11 dígitos corridos: DDD + celular) ──────
   Retorna '' se válido, ou a mensagem de erro explicando o que corrigir. */
function lan4ValidaTelefone(raw) {
  var val = (raw || '').trim();
  if (!val) return 'Preencha o telefone (ex.: 11998765432).';
  var invalidos = val.replace(/[0-9]/g, '');
  if (invalidos) {
    var unicos = invalidos.split('').filter(function (c, i, a) { return a.indexOf(c) === i; })
      .map(function (c) { return c === ' ' ? 'espaço' : '\"' + c + '\"'; }).join(', ');
    return 'O telefone deve ter apenas números, sem ' + unicos + '. Digite DDD + celular corrido (ex.: 11998765432).';
  }
  if (val.length === 13 && val.indexOf('55') === 0) {
    return 'Digite sem o código do país (55): apenas DDD + celular, 11 dígitos (ex.: 11998765432).';
  }
  if (val.length !== 11) {
    return 'O telefone deve ter 11 dígitos (DDD + celular, ex.: 11998765432). Você digitou ' + val.length + '.';
  }
  return '';
}

/* Valor de um campo por name — cobre input/select, radio e checkbox */
function lan4CampoValor(form, name) {
  var el = form.querySelector('[name="' + name + '"]');
  if (!el) return '';
  if (el.type === 'radio') {
    var marcado = form.querySelector('[name="' + name + '"]:checked');
    return marcado ? marcado.value : '';
  }
  if (el.type === 'checkbox') return el.checked ? 'sim' : '';
  return (el.value || '').trim();
}

/* Validação de campos obrigatórios — retorna '' ou mensagem com o campo faltante */
function lan4ValidaObrigatorios(form, campos) {
  for (var i = 0; i < campos.length; i++) {
    if (!lan4CampoValor(form, campos[i][0])) return 'Preencha o campo obrigatório: ' + campos[i][1] + '.';
  }
  return '';
}

/* Campos obrigatórios declarados no HTML: data-req="name:Rótulo,name:Rótulo" por etapa */
function lan4ReqEtapa(step) {
  return (step.getAttribute('data-req') || '').split(',').filter(Boolean).map(function (par) {
    var i = par.indexOf(':');
    return [par.slice(0, i).trim(), par.slice(i + 1).trim()];
  });
}

/* Todos os obrigatórios do form (união das etapas) — usado na validação do submit */
function lan4ReqDoForm(form) {
  var campos = [];
  $$('.lf-step', form).forEach(function (s) { campos = campos.concat(lan4ReqEtapa(s)); });
  return campos;
}

/* Identificador de conversão do RD por form: declarado em data-rd-id no <form>
   (páginas de serviço usam identificadores próprios, ex.: lan4-lp-redes-sociais) */
function lan4FormId(form, fallback) {
  return form.getAttribute('data-rd-id') || fallback || form.id || 'form-sem-id';
}

/* Campos extras específicos da página: grupos com data-rd-cf="cf_x" data-rd-name="name"
   entram no payload do RD sem mexer no JS — cada página declara os seus no HTML */
function lan4ExtrasRd(form) {
  var extras = {};
  $$('[data-rd-cf]', form).forEach(function (el) {
    var valor = lan4CampoValor(form, el.getAttribute('data-rd-name') || '');
    if (valor) extras[el.getAttribute('data-rd-cf')] = valor;
  });
  return extras;
}

/* ─── Sticky CTA mobile ────────────────────────────────────────────────
   Aparece após rolar a 1ª dobra e some quando o formulário de contato
   está visível (para não cobrir campos/botão de envio). Clique já é
   trackeado pelo listener global de data-cta. */
(function () {
  var bar = document.getElementById('sticky-cta');
  if (!bar) return;
  var contato = document.getElementById('contato');
  var formVisivel = false;

  function atualiza() {
    var mostrar = window.scrollY > 500 && !formVisivel;
    bar.classList.toggle('is-visible', mostrar);
    bar.setAttribute('aria-hidden', mostrar ? 'false' : 'true');
  }

  /* iOS Safari: a barra de ferramentas inferior do navegador expande ao
     arrastar para cima e cobre elementos fixados em bottom:0 (que ancoram
     no viewport de LAYOUT). Aqui a barra é recolada ao viewport VISUAL
     sempre que a UI do Safari cresce/encolhe. */
  function ajustaViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    var offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    bar.style.bottom = offset + 'px';
  }

  if (contato && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      formVisivel = entries[0].isIntersecting;
      atualiza();
    }, { rootMargin: '0px 0px -15% 0px' }).observe(contato);
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ajustaViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', ajustaViewport, { passive: true });
  }
  window.addEventListener('resize', ajustaViewport, { passive: true });
  window.addEventListener('scroll', atualiza, { passive: true });
  ajustaViewport();
  atualiza();
})();

/* form_start — primeira interação com cada formulário (1× por form) */
document.addEventListener('focusin', function (e) {
  var form = e.target && e.target.closest ? e.target.closest('form') : null;
  if (!form || form.dataset.lan4Started) return;
  form.dataset.lan4Started = '1';
  window.dataLayer.push({
    event: 'form_start',
    form_identifier: lan4FormId(form, form.id === 'lf' ? 'lan4-contato-site' : (form.id === 'lf2' ? 'lan4-servicos-cta' : ''))
  });
  window.LAN4_FORM_START = true;
  if (window.LAN4_ON_FORM_START_BEFORE_TIMER) window.LAN4_ON_FORM_START_BEFORE_TIMER();
  if (window.LAN4_ON_FORM_START) window.LAN4_ON_FORM_START();
});

/* cta_click — qualquer elemento com data-cta */
document.addEventListener('click', function (e) {
  var el = e.target && e.target.closest ? e.target.closest('[data-cta]') : null;
  if (!el) return;
  window.dataLayer.push({
    event: 'cta_click',
    cta_id: el.getAttribute('data-cta'),
    cta_text: (el.textContent || '').trim().slice(0, 80),
    cta_location: el.getAttribute('data-cta-location') || ''
  });
});
/* ─── Formulários multi-etapas ──────────────────────────────────────────
   Progress bar, validação por etapa e evento form_step no dataLayer —
   cada avanço válido vira um degrau do funil de abandono no GA4. */
function lan4MultiStep(form, identificador) {
  if (!form) return;
  var steps = $$('.lf-step', form);
  if (!steps.length) return;
  var segs  = $$('.lf-progress-seg', form);
  var count = $('[data-step-current]', form);
  var title = $('[data-step-title]', form);
  var cur = 0;

  function mostra(i) {
    steps.forEach(function (s, j) { s.classList.toggle('is-active', j === i); });
    segs.forEach(function (s, j) {
      s.classList.toggle('is-done', j < i);
      s.classList.toggle('is-active', j === i);
    });
    if (count) count.textContent = String(i + 1);
    if (title) title.textContent = steps[i].getAttribute('data-step-title') || '';
    cur = i;
  }

  function validaEtapa(i) {
    var step = steps[i];
    var erro = lan4ValidaObrigatorios(form, lan4ReqEtapa(step));
    if (!erro && step.querySelector('[name="telefone"]')) erro = lan4ValidaTelefone(lan4CampoValor(form, 'telefone'));
    var m = $('.lf-step-msg', step);
    if (m) { m.style.display = erro ? 'block' : 'none'; m.textContent = erro || ''; }
    return !erro;
  }

  /* Enter num input antes da última etapa avança em vez de submeter */
  form.lan4StepGuard = function () {
    if (cur >= steps.length - 1) return false;
    var btn = $('.lf-next', steps[cur]);
    if (btn) btn.click();
    return true;
  };
  form.lan4ValidaEtapaAtual = function () { return validaEtapa(cur); };
  form.lan4Reinicia = function () { mostra(0); };

  $$('.lf-next', form).forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!validaEtapa(cur)) return;
      window.dataLayer.push({
        event: 'form_step',
        form_identifier: identificador,
        form_step_number: cur + 1,
        form_step_name: steps[cur].getAttribute('data-step-name') || '',
        form_step_total: steps.length
      });
      mostra(cur + 1);
      (form.closest('.lf-wrap') || form).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $$('.lf-back', form).forEach(function (btn) {
    btn.addEventListener('click', function () { if (cur > 0) mostra(cur - 1); });
  });

  mostra(0);
}
(function () {
  var lf  = document.getElementById('lf');
  var lf2 = document.getElementById('lf2');
  if (lf)  lan4MultiStep(lf,  lan4FormId(lf,  'lan4-contato-site'));
  if (lf2) lan4MultiStep(lf2, lan4FormId(lf2, 'lan4-servicos-cta'));
})();

/* ─── Envio ao RD Station — com modo prévia ─────────────────────────────
   Fora de lan4.com.br (window.LAN4_PREVIEW, definido no index.html) o
   POST não acontece: simula sucesso p/ validar a UX sem criar lead. */
function lan4EnviaRd(payload) {
  if (window.LAN4_PREVIEW) {
    return new Promise(function (res) {
      setTimeout(function () {
        res({ ok: true, status: 200, json: function () { return Promise.resolve({ preview: true }); } });
      }, 500);
    });
  }
  return fetch('https://app.rdstation.com.br/api/1.3/conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/* Selo visual do modo prévia */
if (window.LAN4_PREVIEW) {
  var lan4Badge = document.createElement('div');
  lan4Badge.className = 'lan4-preview-badge';
  lan4Badge.textContent = 'Prévia de validação · envios desativados';
  document.body.appendChild(lan4Badge);
}

/* ─── fim LAN4 Tracking Layer ───────────────────────────────────────── */

/* Firefox (Gecko/WebRender) reteselagem de clip-path com "round" animado
   é bem mais cara que no Chromium — usado pra simplificar essa animação
   só nesse motor (ver .servicos-section-bg / .problems-section-bg). */
const IS_FIREFOX = CSS.supports('-moz-appearance', 'none');

/* ─── Header scroll ──────────────────────────────────────────────────── */
const header = $('.header');

const COMPACT_THRESHOLD = 10;

const handleScroll = () => {
  const y = window.scrollY;
  header.classList.toggle('header--scrolled', y > 10);
  header.classList.toggle('header--compact',  y > COMPACT_THRESHOLD);
};

/* Agrupa todo trabalho de scroll (header + bg clip-path) num único rAF
   por frame — evita rodar leitura de layout + repaint a cada evento
   nativo de scroll, que pode disparar dezenas de vezes por frame. */
let scrollScheduled = false;
function onScroll(extra) {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    handleScroll();
    extra?.forEach(fn => fn());
  });
}

const scrollCallbacks = [];
window.addEventListener('scroll', () => onScroll(scrollCallbacks), { passive: true });
handleScroll();

/* ─── Pointer glow (radial gradient seguindo o mouse) ───────────────── */
// Listener por botão (só roda enquanto o mouse está sobre ele) em vez de
// um mousemove global que reconsultava o DOM e recalculava a posição de
// TODOS os botões a cada pixel de movimento do mouse na página inteira.
$$('[data-pointer-glow]').forEach(btn => {
  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty('--px', `${e.clientX - rect.left}px`);
    btn.style.setProperty('--py', `${e.clientY - rect.top}px`);
  });
});

/* ─── Dropdown navigation ────────────────────────────────────────────── */
let closeTimer = null;

$$('.nav-item').forEach(item => {
  const btn      = item.querySelector('.nav-btn');
  const dropdown = item.querySelector('.dropdown');
  if (!btn || !dropdown) return;

  const open = () => {
    clearTimeout(closeTimer);
    // fecha outros dropdowns
    $$('.dropdown[data-state="open"]').forEach(d => {
      if (d !== dropdown) {
        d.dataset.state = 'closed';
        d.closest('.nav-item')?.querySelector('.nav-btn')?.removeAttribute('data-state');
      }
    });
    dropdown.dataset.state = 'open';
    btn.dataset.state = 'open';
    positionArrow(dropdown, btn);
  };

  const close = (delay = 120) => {
    closeTimer = setTimeout(() => {
      dropdown.dataset.state = 'closed';
      delete btn.dataset.state;
    }, delay);
  };

  btn.addEventListener('mouseenter', open);
  btn.addEventListener('focus',      open);
  btn.addEventListener('mouseleave', () => close());
  btn.addEventListener('blur',       () => close(200));

  dropdown.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  dropdown.addEventListener('mouseleave', () => close());

  // Fecha com Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close(0);
  });
});

// Fecha ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('.nav-item')) {
    $$('.dropdown[data-state="open"]').forEach(d => {
      d.dataset.state = 'closed';
      d.closest('.nav-item')?.querySelector('.nav-btn')?.removeAttribute('data-state');
    });
  }
});

/**
 * Alinha a setinha do dropdown com o botão que o abriu.
 * O site original faz isso com JS para compensar o translate(-50%).
 */
function positionArrow(dropdown, btn) {
  const arrow = dropdown.querySelector('.dropdown-arrow');
  if (!arrow) return;
  const ddRect  = dropdown.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const btnMid  = btnRect.left + btnRect.width / 2;
  const ddMid   = ddRect.left  + ddRect.width  / 2;
  const offset  = btnMid - ddMid;
  dropdown.style.setProperty('--arrow-offset', `${offset}px`);
}

/* ─── Mobile menu (panel deslizante) ────────────────────────────────── */
const menuToggle  = $('.menu-toggle');
const mobilePanel = $('#mobilePanel');

if (menuToggle && mobilePanel) {
  let panelOpen = false;

  function openPanel() {
    panelOpen = true;
    mobilePanel.classList.add('is-open');
    menuToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closePanel() {
    panelOpen = false;
    mobilePanel.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  menuToggle.addEventListener('click', () => panelOpen ? closePanel() : openPanel());

  $$('.mobile-panel-link', mobilePanel).forEach(link => {
    link.addEventListener('click', closePanel);
  });

  const panelCta = mobilePanel.querySelector('.mobile-panel-cta .btn');
  if (panelCta) panelCta.addEventListener('click', closePanel);
}

/* ─── Serviços — Carrossel infinito ─────────────────────────────────── */
(function () {
  const viewport = $('.servicos-carousel-viewport');
  const track    = $('.servicos-track');
  const prevBtn  = $('.servicos-arrow--prev');
  const nextBtn  = $('.servicos-arrow--next');
  if (!track || !viewport) return;

  function GAP() {
    return parseFloat(getComputedStyle(track).columnGap) || 20;
  }

  const origCards = [...track.children]; /* 6 cards reais */
  const N = origCards.length;

  /* Estrutura final: [clone1..N] [real1..N] [clone1..N]  (3N = 18 cards) */
  /* Prepend: clones em ordem dos originais */
  for (let i = N - 1; i >= 0; i--) {
    track.insertBefore(origCards[i].cloneNode(true), track.firstChild);
  }
  /* Append */
  origCards.forEach(c => track.appendChild(c.cloneNode(true)));

  let idx = N; /* começa no primeiro card real */
  let busy = false;

  function cardW() {
    return track.children[0]?.offsetWidth || 0;
  }

  /* No mobile (1 card por vez, mais estreito que o viewport) centraliza
     o card ativo, deixando os vizinhos espiarem nas duas laterais. */
  function centerOffset() {
    const vw = viewport.offsetWidth;
    const cw = cardW();
    return vw <= 500 ? (vw - cw) / 2 : 0;
  }

  /* Posiciona sem animação */
  function snap(i) {
    track.style.transition = 'none';
    track.style.transform  = `translateX(${centerOffset() - (i * (cardW() + GAP()))}px)`;
    void track.offsetWidth; /* force reflow */
    track.style.transition = '';
  }

  /* Posiciona com animação */
  function goTo(i) {
    if (busy) return;
    busy = true;
    idx = i;
    track.style.transform = `translateX(${centerOffset() - (idx * (cardW() + GAP()))}px)`;
  }

  track.addEventListener('transitionend', e => {
    if (e.target !== track) return;
    busy = false;
    if (idx < N)       { idx += N; snap(idx); }
    else if (idx >= N * 2) { idx -= N; snap(idx); }
  });

  /* Arrows sempre habilitadas (loop infinito) */
  [prevBtn, nextBtn].forEach(b => {
    b.disabled = false;
    b.classList.remove('is-disabled');
  });

  /* Auto-play — avança 1 card a cada 2 segundos, pausa no hover/foco */
  let autoTimer = null;

  function startAuto() {
    stopAuto();
    autoTimer = setInterval(() => goTo(idx + 1), 2000);
  }

  function stopAuto() {
    clearInterval(autoTimer);
  }

  const wrap = viewport.closest('.servicos-carousel-wrap') || viewport.parentElement;
  wrap.addEventListener('mouseenter', stopAuto);
  wrap.addEventListener('mouseleave', startAuto);
  wrap.addEventListener('focusin',    stopAuto);
  wrap.addEventListener('focusout',   startAuto);

  /* Pausa o autoplay fora da tela — sem isso ele fica avançando (e
     disparando transitionend) pra sempre, mesmo com o carrossel longe
     da viewport. */
  new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? startAuto() : stopAuto());
  }, { threshold: 0 }).observe(wrap);

  prevBtn.addEventListener('click', () => { stopAuto(); goTo(idx - 1); startAuto(); });
  nextBtn.addEventListener('click', () => { stopAuto(); goTo(idx + 1); startAuto(); });

  window.addEventListener('resize', () => snap(idx), { passive: true });

  requestAnimationFrame(() => requestAnimationFrame(() => { snap(idx); startAuto(); }));

  /* ── Drag / swipe — mouse e touch ── */
  let dragStartX = 0;
  let dragDeltaX = 0;
  let dragActive = false;

  /* ── Drag / swipe — sem setPointerCapture para não quebrar clicks ── */
  viewport.addEventListener('pointerdown', e => {
    dragStartX = e.clientX;
    dragDeltaX = 0;
    dragActive = true;
    track.style.transition = 'none';
    stopAuto();
  });

  window.addEventListener('pointermove', e => {
    if (!dragActive) return;
    dragDeltaX = e.clientX - dragStartX;
    track.style.transform = `translateX(${centerOffset() - (idx * (cardW() + GAP())) + dragDeltaX}px)`;
  });

  window.addEventListener('pointerup', () => {
    if (!dragActive) return;
    dragActive = false;
    track.style.transition = '';
    busy = false;
    if      (dragDeltaX < -50) goTo(idx + 1);
    else if (dragDeltaX >  50) goTo(idx - 1);
    else                        snap(idx);
    startAuto();
  });

  window.addEventListener('pointercancel', () => {
    if (!dragActive) return;
    dragActive = false;
    track.style.transition = '';
    snap(idx);
    startAuto();
  });

  /* Evita abrir popup quando o usuário estava arrastando */
  viewport.addEventListener('click', e => {
    if (Math.abs(dragDeltaX) > 10) e.stopPropagation();
  }, true);
})();

/* ─── Problemas — ticker JS-driven com drag ─────────────────────────── */
(function () {
  const wrap  = $('.problems-track-wrap');
  const track = $('.problems-track');
  if (!wrap || !track) return;

  /* Desativa animação CSS — controle total via JS */
  track.style.animation = 'none';

  const CYCLE_SECS = 34;
  let posX      = 0;
  let lastTs    = null;
  let hovering  = false;
  let dragging  = false;
  let dragStartX = 0;
  let dragPosX   = 0;
  let rafId     = null;

  function totalW() { return track.scrollWidth / 2; }

  function tick(ts) {
    if (lastTs !== null && !dragging && !hovering) {
      const dt    = Math.min((ts - lastTs) / 1000, 0.05); /* cap a 50ms */
      const tw    = totalW();
      const speed = tw / CYCLE_SECS;
      posX -= speed * dt;
      if (posX <= -tw) posX += tw;
    }
    lastTs = ts;
    track.style.transform = `translateX(${posX}px)`;
    rafId = requestAnimationFrame(tick);
  }

  /* Só anima enquanto a seção está visível — sem isso o loop rodava pra
     sempre desde o load, lendo scrollWidth (força layout) a cada frame
     em QUALQUER lugar da página, competindo por CPU com o resto do site. */
  const visibilityObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && rafId === null) {
        lastTs = null; /* evita salto de dt ao retomar depois de pausado */
        rafId = requestAnimationFrame(tick);
      } else if (!entry.isIntersecting && rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    });
  }, { threshold: 0 });
  visibilityObs.observe(wrap);

  /* Pausa no hover — apenas dispositivos com cursor real */
  wrap.addEventListener('mouseenter', () => { hovering = true;  });
  wrap.addEventListener('mouseleave', () => { hovering = false; });

  /* Drag */
  wrap.addEventListener('pointerdown', e => {
    dragging   = true;
    dragStartX = e.clientX;
    dragPosX   = posX;
  });

  window.addEventListener('pointermove', e => {
    if (!dragging) return;
    const tw = totalW();
    posX = dragPosX + (e.clientX - dragStartX);
    while (posX > 0)   posX -= tw;
    while (posX < -tw) posX += tw;
  });

  window.addEventListener('pointerup',     () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });
})();

/* ─── Serviços — Background scroll-driven ───────────────────────────── */
(function () {
  const section = $('.servicos-section');
  const bg      = section?.querySelector('.servicos-section-bg');
  if (!section || !bg) return;

  let lastClip = null;

  function updateBg() {
    const vw   = window.innerWidth;
    const rect = section.getBoundingClientRect();
    const vh   = window.innerHeight;

    /* progress: 0 quando seção entra pela base, 1 quando topo chega a 25% do viewport */
    const progress = Math.max(0, Math.min(1, (vh - rect.top) / (vh * 0.75)));

    const startHalf = vw > 640 ? 400 : 150; /* 800px desktop / 300px mobile dividido por 2 */
    const half      = startHalf + (vw / 2 - startHalf) * progress;
    const clip      = Math.round(Math.max(0, vw / 2 - half));

    /* O raio arredondado é a parte mais cara de recalcular a cada frame
       (o navegador retesela os cantos do clip-path). Zerando-o logo no
       início do trecho (35% do progresso) — em vez de ao longo de todo
       ele — mantém a mesma duração/distância de scroll, mas deixa a
       maior parte da transição usando só um clip retangular, bem mais
       leve de renderizar. */
    const radiusProgress = IS_FIREFOX ? 1 : Math.min(1, progress / 0.35);
    const radius = Math.round(44 * (1 - radiusProgress));

    const next = `inset(0 ${clip}px round ${radius}px)`;
    if (next === lastClip) return;
    lastClip = next;
    bg.style.clipPath = next;
  }

  scrollCallbacks.push(updateBg);
  window.addEventListener('resize', updateBg, { passive: true });
  updateBg();
})();

/* ─── Problemas — Background sólido preto, mesma animação de "pílula
   que expande" da seção de serviços ──────────────────────────────── */
(function () {
  const section = $('.problems-section');
  const bg      = section?.querySelector('.problems-section-bg');
  if (!section || !bg) return;

  let lastClip = null;

  function updateBg() {
    const vw   = window.innerWidth;
    const rect = section.getBoundingClientRect();
    const vh   = window.innerHeight;

    const progress = Math.max(0, Math.min(1, (vh - rect.top) / (vh * 0.75)));

    const startHalf = vw > 640 ? 400 : 150;
    const half      = startHalf + (vw / 2 - startHalf) * progress;
    const clip      = Math.round(Math.max(0, vw / 2 - half));

    const radiusProgress = IS_FIREFOX ? 1 : Math.min(1, progress / 0.35);
    const radius = Math.round(44 * (1 - radiusProgress));

    const next = `inset(0 ${clip}px round ${radius}px)`;
    if (next === lastClip) return;
    lastClip = next;
    bg.style.clipPath = next;
  }

  scrollCallbacks.push(updateBg);
  window.addEventListener('resize', updateBg, { passive: true });
  updateBg();
})();

/* ─── Lazy background-images ─────────────────────────────────────────
   Cards e popups usam data-bg em vez de background-image inline no HTML.
   Sem isso, o navegador baixava TODAS as imagens de fundo já no carregamento
   da página — incluindo as dos 14 popups de serviço, que ficam sempre no
   DOM (display:flex) e só viram invisíveis via opacity. Isso somava ~2MB
   de imagens de popups fechados baixadas antes de qualquer interação. */
function applyLazyBg(el) {
  if (!el.dataset.bg) return;
  el.style.backgroundImage = `url('${el.dataset.bg}')`;
  delete el.dataset.bg;
}

/* Cards: carregam ao chegar perto da viewport (scroll) */
const bgObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      applyLazyBg(entry.target);
      bgObserver.unobserve(entry.target);
    }
  });
}, { rootMargin: '300px' });

$$('.servico-card-img[data-bg]').forEach(el => bgObserver.observe(el));

/* ─── Serviços — Popups ──────────────────────────────────────────────── */
let _lastFocused = null;

function openServicosPopup(popupId) {
  const popup = $('#' + popupId);
  if (!popup) return;
  /* Popups são fixed/inset:0 — IntersectionObserver os considera sempre
     visíveis mesmo fechados, então a imagem só pode ser carregada aqui,
     no momento real da abertura. */
  popup.querySelectorAll('[data-bg]').forEach(applyLazyBg);
  _lastFocused = document.activeElement;
  popup.classList.add('is-open');
  popup.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => popup.querySelector('.servico-popup-close')?.focus());
}

function closeServicosPopup(popup) {
  popup.classList.remove('is-open');
  popup.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  _lastFocused?.focus();
}

$$('.servico-card, .bu-card').forEach(card => {
  const open = () => openServicosPopup(card.dataset.popup);
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
});

$$('.servico-popup-close').forEach(btn => {
  btn.addEventListener('click', () => closeServicosPopup(btn.closest('.servico-popup')));
});

/* Clique no backdrop (fora do card) fecha o popup */
$$('.servico-popup').forEach(popup => {
  popup.addEventListener('click', e => {
    if (!e.target.closest('.servico-popup-card')) closeServicosPopup(popup);
  });
});

/* CTA "Saiba mais" dentro do popup — fecha o popup antes de rolar até o form */
$$('.servico-popup-copy a[href^="#"]').forEach(link => {
  link.addEventListener('click', () => closeServicosPopup(link.closest('.servico-popup')));
});

/* Footer — botões que abrem popups de serviços */
$$('[data-popup-open]').forEach(btn => {
  btn.addEventListener('click', () => openServicosPopup(btn.dataset.popupOpen));
});

/* ─── Mini-form da seção de serviços ────────────────────────────────── */
(function () {
  var form = document.getElementById('lf2');
  var msg  = document.getElementById('lf2-msg');
  if (!form) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.lan4StepGuard && form.lan4StepGuard()) return; // Enter antes da última etapa só avança
    var v   = function (n) { return lan4CampoValor(form, n); };
    var btn = form.querySelector('button[type="submit"]');
    var btnTexto = btn.textContent;
    var identificador = lan4FormId(form, 'lan4-servicos-cta');

    var erro = lan4ValidaObrigatorios(form, lan4ReqDoForm(form)) || lan4ValidaTelefone(v('telefone'));
    if (erro) {
      msg.className = 'lf-msg err';
      msg.style.display = 'block';
      msg.textContent = erro;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando…';
    msg.style.display = 'none';

    // Captura os valores ANTES do fetch/reset — usados no tracking pós-sucesso
    var lead = {
      nome: v('nome'), email: v('email'), telefone: v('telefone'),
      empresa: v('empresa'), cargo: v('cargo'),
      faturamento: v('faturamento'), ticket: v('ticket')
    };

    lan4EnviaRd(Object.assign({
      token_rdstation:              'd5d170dfe71825a3ebc37e6699f10652',
      identificador:                identificador,
      email:                        lead.email,
      nome:                         lead.nome,
      telefone:                     lead.telefone,
      empresa:                      lead.empresa,
      cf_cargo:                     lead.cargo,
      cf_faturamento_medio_mensal:  lead.faturamento,
      cf_ticket_medio_aproximado:   lead.ticket
    }, lan4ExtrasRd(form), lan4RdUtmPayload()))
    .then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(r.status);
        lan4PushLead(identificador, lead);
        form.reset();
        form.classList.add('is-sent');
        msg.className = 'lf-msg ok';
        msg.style.display = 'block';
        msg.textContent = '✓ Recebemos suas informações! Alguém do nosso time vai entrar em contato com você em breve.';
      });
    })
    .catch(function () {
      msg.className = 'lf-msg err';
      msg.style.display = 'block';
      msg.textContent = 'Ocorreu um erro. Tente novamente.';
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = btnTexto;
    });
  });
})();

/* ─── Formulário de contato → RD Station ────────────────────────────── */
(function () {
  var form = document.getElementById('lf');
  var msg  = document.getElementById('lf-msg');
  if (!form) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.lan4StepGuard && form.lan4StepGuard()) return; // Enter antes da última etapa só avança
    var v   = function (n) { return lan4CampoValor(form, n); };
    var btn = form.querySelector('button[type="submit"]');
    var btnTexto = btn.textContent;
    var identificador = lan4FormId(form, 'lan4-contato-site');

    // Validação: obrigatórios declarados em data-req + telefone 11 dígitos corridos
    var erro = lan4ValidaObrigatorios(form, lan4ReqDoForm(form)) || lan4ValidaTelefone(v('telefone'));
    if (erro) {
      msg.className = 'lf-msg err';
      msg.style.display = 'block';
      msg.textContent = erro;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando…';
    msg.style.display = 'none';

    // Captura os valores ANTES do fetch/reset — usados no tracking pós-sucesso
    var lead = {
      nome: v('nome'), email: v('email'), telefone: v('telefone'),
      empresa: v('empresa'), cargo: v('cargo'),
      faturamento: v('faturamento'), ticket: v('ticket')
    };

    lan4EnviaRd(Object.assign({
      token_rdstation:              'd5d170dfe71825a3ebc37e6699f10652',
      identificador:                identificador,
      email:                        lead.email,
      nome:                         lead.nome,
      telefone:                     lead.telefone,
      empresa:                      lead.empresa,
      cf_cargo:                     lead.cargo,
      cf_faturamento_medio_mensal:  lead.faturamento,
      cf_ticket_medio_aproximado:   lead.ticket
    }, lan4ExtrasRd(form), lan4RdUtmPayload()))
    .then(function (r) {
      return r.json().then(function (data) {
        console.log('[RD Station] status:', r.status, 'response:', data);
        if (!r.ok) throw new Error(r.status + ' – ' + JSON.stringify(data));
        lan4PushLead(identificador, lead);
        form.reset();
        form.classList.add('is-sent');
        msg.className = 'lf-msg ok';
        msg.style.display = 'block';
        msg.innerHTML = '✓ Recebemos suas informações!<br>Alguém do nosso time vai entrar em contato com você em breve — fique de olho no WhatsApp e no e-mail.';
      });
    })
    .catch(function (err) {
      console.error('[RD Station] erro:', err);
      msg.className = 'lf-msg err';
      msg.style.display = 'block';
      msg.textContent = 'Ocorreu um erro. Tente novamente ou fale pelo WhatsApp.';
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = btnTexto;
    });
  });
})();

/* ─── Pausa vídeos em loop quando saem da tela (reduz decode simultâneo) ──
   Inclui o vídeo do hero — sem isso ele decodifica pra sempre, mesmo
   rolado pra fora da tela, competindo com todo o resto por CPU/GPU. */
(function () {
  const videos = $$('.mandala-video, .hero-video-bg');
  if (!videos.length) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => entry.isIntersecting ? entry.target.play() : entry.target.pause());
  }, { threshold: 0.1 });
  videos.forEach(v => obs.observe(v));
})();

/* ─── FAQ accordion ──────────────────────────────────────────────────── */
$$('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    const answer = btn.nextElementSibling;

    // Fecha todos os outros
    $$('.faq-question').forEach(other => {
      if (other !== btn) {
        other.setAttribute('aria-expanded', 'false');
        other.nextElementSibling.classList.remove('is-open');
      }
    });

    // Alterna este
    btn.setAttribute('aria-expanded', String(!isOpen));
    answer.classList.toggle('is-open', !isOpen);
  });
});

/* ─── Scroll reveal (IntersectionObserver) ──────────────────────────── */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

/* ─── Botão flutuante WhatsApp ───────────────────────────────────────
   Aparece após LAN4_WHATSAPP_DELAY_MS (8s — faixa de mercado para
   gatilhos proativos de chat/WhatsApp: 8–15s). Some ao
   primeiro form_start para não competir com quem já está preenchendo.
   Antes de abrir o WhatsApp, coleta nome/e-mail/telefone num modal leve
   e envia como lead real ao RD (identificador lan4-whatsapp-click) —
   pedido do Guilherme (23/07): sem isso o clique não vira lead
   rastreável no CRM, só um evento de analytics. Mensagem cita o serviço
   da página (LAN4_SERVICO_PAGINA) e anexa a origem só quando há UTM
   real na sessão — nunca alega mídia paga sem o dado vir da URL. */
(function () {
  var LAN4_WHATSAPP_NUMERO = '5511944877193';
  var LAN4_WHATSAPP_DELAY_MS = 8000;
  var LAN4_WHATSAPP_IDENTIFICADOR = 'lan4-whatsapp-click';

  /* Foco amarelo (marca) nos campos do modal — inline style não suporta
     :focus, injeta uma vez só no <head>. */
  (function () {
    var style = document.createElement('style');
    style.textContent = '#lan4-whatsapp-modal-overlay *{box-sizing:border-box;max-width:100%;}'
      + '#lan4-whatsapp-form input:focus{outline:none;border-color:#FFD900 !important;background:rgba(255,217,0,.08) !important;}'
      + '#lan4-whatsapp-form input::placeholder{color:rgba(255,255,255,.4);}'
      + '#lan4-whatsapp-enviar:hover{background:#1EBE5B;}'
      + '#lan4-whatsapp-cancelar:hover{color:#fff;}';
    document.head.appendChild(style);
  })();

  /* Mesmo serviço do hero de cada página (ver upload/s/<slug>/index.html) —
     mantém a mensagem do WhatsApp consistente com o que a pessoa viu.
     Padrão: "Olá, me chamo [Nome]! Vim do site da LAN4 e tenho interesse em <frase>". */
  var LAN4_WHATSAPP_MSG_POR_SERVICO = {
    'Gestão de Redes Sociais':    'na gestão de redes sociais de vocês',
    'Vendas e CRM':               'na terceirização de vendas e CRM de vocês',
    'Mídia Paga':                 'na gestão de mídia paga de vocês',
    'Marketing Digital':          'no marketing digital de vocês',
    'Recrutamento e Seleção':     'no recrutamento e seleção de vocês',
    'Audiovisual e Conteúdo':     'na produção audiovisual de vocês',
    'Eventos Corporativos':       'na organização de eventos de vocês'
  };

  function lan4WhatsappMensagem(nome) {
    var servico = window.LAN4_SERVICO_PAGINA || '';
    var interesse = LAN4_WHATSAPP_MSG_POR_SERVICO[servico] || 'nas soluções de vocês';
    var saudacao = nome ? 'Olá, me chamo ' + nome + '! ' : 'Olá! ';
    return saudacao + 'Vim do site da LAN4 e tenho interesse ' + interesse + '.';
  }

  function lan4WhatsappLink(nome) {
    var msg = encodeURIComponent(lan4WhatsappMensagem(nome));
    return 'https://wa.me/' + LAN4_WHATSAPP_NUMERO + '?text=' + msg;
  }

  function lan4WhatsappPushLead(lead) {
    var utms = lan4GetUtms();
    window.dataLayer.push({
      event: 'whatsapp_click',
      cf_utm_source: utms.utm_source || '',
      cf_utm_medium: utms.utm_medium || '',
      cf_utm_campaign: utms.utm_campaign || '',
      cf_servico_de_interesse: window.LAN4_SERVICO_PAGINA || lan4ServicoInteresse(utms) || ''
    });
    lan4PushLead(LAN4_WHATSAPP_IDENTIFICADOR, lead, 'whatsapp_lead_submit');
  }

  /* ─── Modal de captura (nome/e-mail/telefone) ───────────────────────── */
  function lan4CriaModalWhatsapp() {
    var overlay = document.createElement('div');
    overlay.id = 'lan4-whatsapp-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);'
      + 'display:flex;align-items:center;justify-content:center;z-index:10001;'
      + 'padding:16px;box-sizing:border-box;';

    /* Cores da marca LAN4 (mesma paleta do site: index.html linhas 131/160/177):
       fundo #0A1428 (azul-marinho), destaque #FFD900 (amarelo), texto claro.
       max-width em calc() (não px fixo) evita extrapolar em telas estreitas
       (a largura já desconta o padding:16px do overlay dos dois lados). */
    var box = document.createElement('div');
    box.style.cssText = 'background:#0A1428;color:#fff;border-radius:14px;padding:28px 24px;'
      + 'width:100%;max-width:min(360px,calc(100vw - 32px));font-family:inherit;'
      + 'border:1px solid rgba(255,217,0,.25);box-shadow:0 20px 60px rgba(0,0,0,.5);'
      + 'box-sizing:border-box;';
    /* Div em vez de <form>: o listener global de focusin (linha ~233)
       dispara form_start em QUALQUER <form> da página — usar <form> aqui
       sujaria o dataLayer com um form_identifier espúrio e escondería o
       botão flutuante sem necessidade (window.LAN4_FORM_START). */
    box.innerHTML =
      '<h3 style="margin:0 0 4px;font-size:19px;color:#fff;">Antes de continuar</h3>'
      + '<p style="margin:0 0 18px;font-size:13px;color:rgba(255,255,255,.65);">Deixe seus dados pra já entrarmos em contato mesmo se a conversa cair.</p>'
      + '<div id="lan4-whatsapp-form" novalidate>'
      + '  <input name="nome" autocomplete="name" placeholder="Nome" required style="width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:10px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;font-size:14px;background:rgba(255,255,255,.06);color:#fff;">'
      + '  <input name="email" type="email" autocomplete="email" placeholder="E-mail" required style="width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:10px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;font-size:14px;background:rgba(255,255,255,.06);color:#fff;">'
      + '  <input name="telefone" type="tel" autocomplete="tel-national" placeholder="Telefone (ex.: 11998765432)" required style="width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:6px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;font-size:14px;background:rgba(255,255,255,.06);color:#fff;">'
      + '  <div id="lan4-whatsapp-erro" style="color:#ff8a8a;font-size:12px;min-height:16px;margin-bottom:10px;"></div>'
      + '  <button type="button" id="lan4-whatsapp-enviar" style="width:100%;padding:13px;background:#25D366;color:#fff;border:none;border-radius:999px;font-size:15px;font-weight:700;cursor:pointer;">Continuar no WhatsApp</button>'
      + '  <button type="button" id="lan4-whatsapp-cancelar" style="width:100%;padding:9px;background:transparent;color:rgba(255,255,255,.55);border:none;font-size:13px;cursor:pointer;margin-top:6px;">Cancelar</button>'
      + '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var form = box.querySelector('#lan4-whatsapp-form');
    var erroEl = box.querySelector('#lan4-whatsapp-erro');

    function fecha() { overlay.remove(); }
    box.querySelector('#lan4-whatsapp-cancelar').addEventListener('click', fecha);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) fecha(); });
    document.addEventListener('keydown', function escFecha(e) {
      if (e.key === 'Escape') { fecha(); document.removeEventListener('keydown', escFecha); }
    });

    box.querySelector('#lan4-whatsapp-enviar').addEventListener('click', function (e) {
      e.preventDefault();
      var nome = lan4CampoValor(form, 'nome');
      var email = lan4CampoValor(form, 'email');
      var telefone = lan4CampoValor(form, 'telefone');

      if (!nome) { erroEl.textContent = 'Preencha seu nome.'; return; }
      if (!email || email.indexOf('@') === -1) { erroEl.textContent = 'Preencha um e-mail válido.'; return; }
      var erroTel = lan4ValidaTelefone(telefone);
      if (erroTel) { erroEl.textContent = erroTel; return; }

      var btn = box.querySelector('#lan4-whatsapp-enviar');
      btn.disabled = true;
      btn.textContent = 'Enviando…';

      var lead = { nome: nome, email: email, telefone: telefone };

      lan4EnviaRd(Object.assign({
        token_rdstation: 'd5d170dfe71825a3ebc37e6699f10652',
        identificador: LAN4_WHATSAPP_IDENTIFICADOR,
        email: lead.email,
        nome: lead.nome,
        telefone: lead.telefone
      }, lan4RdUtmPayload()))
      .then(function () {
        lan4WhatsappPushLead(lead);
        fecha();
        window.open(lan4WhatsappLink(nome.split(' ')[0]), '_blank', 'noopener');
      })
      .catch(function () {
        erroEl.textContent = 'Ocorreu um erro. Tente novamente.';
        btn.disabled = false;
        btn.textContent = 'Continuar no WhatsApp';
      });
    });

    form.querySelector('[name="nome"]').focus();
  }

  function lan4CriaBotaoWhatsapp() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'lan4-whatsapp-float';
    btn.setAttribute('aria-label', 'Falar no WhatsApp');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="#fff" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.2 4.74 1.2h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.03c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.12.11-1.81-.11-.42-.13-.96-.31-1.65-.6-2.91-1.26-4.81-4.19-4.96-4.38-.14-.2-1.19-1.58-1.19-3.02s.75-2.15 1.02-2.44c.26-.29.57-.36.76-.36l.55.01c.17.01.41-.06.64.49.24.57.81 1.98.88 2.12.07.15.12.32.02.51-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.61-.07.16-.19.7-.82.89-1.1.19-.29.38-.24.63-.14.26.09 1.66.78 1.94.92.28.14.47.21.54.33.07.12.07.68-.17 1.36z"/></svg>';
    btn.style.cssText = 'position:fixed;right:20px;bottom:20px;width:60px;height:60px;'
      + 'display:flex;align-items:center;justify-content:center;border-radius:50%;'
      + 'background:linear-gradient(135deg,#25D366 0%,#1EBE5B 100%);border:none;cursor:pointer;'
      + 'box-shadow:0 6px 20px rgba(37,211,102,.45),0 2px 8px rgba(0,0,0,.2);'
      + 'z-index:9999;opacity:0;transform:translateY(12px);'
      + 'transition:opacity .3s ease,transform .3s ease,box-shadow .2s ease,bottom .25s ease;';
    btn.addEventListener('mouseenter', function () {
      btn.style.boxShadow = '0 8px 26px rgba(37,211,102,.6),0 2px 8px rgba(0,0,0,.25)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.boxShadow = '0 6px 20px rgba(37,211,102,.45),0 2px 8px rgba(0,0,0,.2)';
    });
    document.body.appendChild(btn);
    requestAnimationFrame(function () {
      btn.style.opacity = '1';
      btn.style.transform = 'translateY(0)';
    });

    /* Sobe o botão acima da sticky bar mobile quando ela estiver visível
       (evita sobrepor o CTA "Falar com a LAN4"). A sticky bar já reposiciona
       seu próprio "bottom" para o viewport visual do Safari (main.js ~L212) —
       aqui só reagimos à classe is-visible, sem duplicar essa lógica. */
    var stickyBar = document.getElementById('sticky-cta');
    if (stickyBar) {
      var ajustaBotaoWhatsapp = function () {
        var stickyVisivel = stickyBar.classList.contains('is-visible')
          && window.getComputedStyle(stickyBar).display !== 'none';
        btn.style.bottom = stickyVisivel
          ? (stickyBar.offsetHeight + 16) + 'px'
          : '20px';
      };
      new MutationObserver(ajustaBotaoWhatsapp)
        .observe(stickyBar, { attributes: true, attributeFilter: ['class'] });
      window.addEventListener('resize', ajustaBotaoWhatsapp, { passive: true });
      ajustaBotaoWhatsapp();
    }

    btn.addEventListener('click', function () {
      lan4CriaModalWhatsapp();
    });

    return btn;
  }

  function lan4RemoveBotaoWhatsapp(btn) {
    if (!btn || !btn.parentNode) return;
    btn.style.opacity = '0';
    btn.style.transform = 'translateY(12px)';
    setTimeout(function () { btn.remove(); }, 300);
  }

  var lan4WhatsappTimer = setTimeout(function () {
    if (window.LAN4_FORM_START) return; // já iniciou o form antes do delay
    var btn = lan4CriaBotaoWhatsapp();
    window.LAN4_ON_FORM_START = function () { lan4RemoveBotaoWhatsapp(btn); };
  }, LAN4_WHATSAPP_DELAY_MS);

  window.LAN4_ON_FORM_START_BEFORE_TIMER = function () {
    clearTimeout(lan4WhatsappTimer);
  };
})();

$$('.reveal').forEach(el => revealObserver.observe(el));

/* ─── Pop-up de saída — material isca (e-book "A Engrenagem") ────────
   Gatilho: exit-intent (mouse saindo pelo topo) no desktop; tempo na
   página + scroll mínimo no mobile (não existe exit-intent em touch).
   Mesmo padrão do modal de WhatsApp: nome/telefone/e-mail, envia como
   lead real ao RD com identificador PRÓPRIO (lan4-material-isca) —
   não entra no MQL automático (sem faturamento/ticket), é um lead de
   menor qualificação por natureza (baixa fricção proposital). O
   material é enviado manualmente pelo comercial via WhatsApp; ao
   enviar o form, abre o WhatsApp já com uma mensagem pré-pronta
   pedindo o material — reduz a espera percebida pelo usuário e não
   depende de resposta imediata do comercial pra criar valor. */
(function () {
  var LAN4_ISCA_IDENTIFICADOR = 'lan4-material-isca';
  var LAN4_ISCA_WHATSAPP_NUMERO = '5511944877193';
  var LAN4_ISCA_SESSION_KEY = 'lan4_isca_popup_shown';
  var LAN4_ISCA_MOBILE_DELAY_MS = 8000; // alinhado à faixa recomendada (8–15s) p/ gatilhos proativos

  /* Não repete na mesma sessão (nem se já converteu em outro form) */
  function lan4IscaJaExibido() {
    try { return sessionStorage.getItem(LAN4_ISCA_SESSION_KEY) === '1'; }
    catch (e) { return false; }
  }
  function lan4IscaMarcaExibido() {
    try { sessionStorage.setItem(LAN4_ISCA_SESSION_KEY, '1'); } catch (e) {}
  }

  (function () {
    var style = document.createElement('style');
    style.textContent = '#lan4-isca-overlay *{box-sizing:border-box;max-width:100%;}'
      + '#lan4-isca-form input:focus{outline:none;border-color:#FFD900 !important;background:rgba(255,217,0,.08) !important;}'
      + '#lan4-isca-form input::placeholder{color:rgba(255,255,255,.4);}'
      + '#lan4-isca-enviar:hover{background:#FFE44D;}'
      + '#lan4-isca-cancelar:hover{color:#fff;}'
      + '@keyframes lan4IscaIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}';
    document.head.appendChild(style);
  })();

  function lan4IscaMensagemWhatsapp(nome) {
    var saudacao = nome ? 'Olá, me chamo ' + nome + '! ' : 'Olá! ';
    return saudacao + 'Preenchi o formulário no site da LAN4 pra receber o material "A Engrenagem que Faz Empresas Crescerem de Verdade". Pode me enviar?';
  }

  function lan4IscaWhatsappLink(nome) {
    var msg = encodeURIComponent(lan4IscaMensagemWhatsapp(nome));
    return 'https://wa.me/' + LAN4_ISCA_WHATSAPP_NUMERO + '?text=' + msg;
  }

  function lan4IscaPushLead(lead) {
    var utms = lan4GetUtms();
    window.dataLayer.push({
      event: 'material_isca_lead',
      cf_utm_source: utms.utm_source || '',
      cf_utm_medium: utms.utm_medium || '',
      cf_utm_campaign: utms.utm_campaign || '',
      cf_servico_de_interesse: window.LAN4_SERVICO_PAGINA || lan4ServicoInteresse(utms) || ''
    });
    lan4PushLead(LAN4_ISCA_IDENTIFICADOR, lead, 'material_isca_lead_submit');
  }

  function lan4FechaModalIsca(overlay) {
    overlay.style.opacity = '0';
    setTimeout(function () { overlay.remove(); }, 200);
  }

  function lan4AbreModalIsca() {
    if (lan4IscaJaExibido()) return;
    lan4IscaMarcaExibido();

    var overlay = document.createElement('div');
    overlay.id = 'lan4-isca-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);'
      + 'display:flex;align-items:center;justify-content:center;z-index:10002;'
      + 'padding:16px;box-sizing:border-box;opacity:1;transition:opacity .2s ease;';

    var box = document.createElement('div');
    box.style.cssText = 'background:'
        + 'radial-gradient(circle at 100% 0%, rgba(255,217,0,.16), transparent 45%),'
        + 'radial-gradient(circle at 0% 100%, rgba(255,217,0,.08), transparent 40%),'
        + '#0A1428;'
      + 'color:#fff;border-radius:16px;padding:0;'
      + 'width:100%;max-width:min(420px,calc(100vw - 32px));font-family:inherit;'
      + 'border:1px solid rgba(255,217,0,.3);box-shadow:0 24px 70px rgba(0,0,0,.55);'
      + 'box-sizing:border-box;overflow:hidden;animation:lan4IscaIn .25s ease;';

    box.innerHTML =
      '<button type="button" id="lan4-isca-x" aria-label="Fechar" style="position:absolute;top:14px;right:16px;background:none;border:none;color:rgba(255,255,255,.55);font-size:22px;line-height:1;cursor:pointer;padding:4px;">&times;</button>'
      + '<div style="padding:26px 24px 8px;">'
      + '  <span style="display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#0A1428;background:#FFD900;border-radius:999px;padding:4px 10px;margin-bottom:14px;">Material gratuito</span>'
      + '  <h3 style="margin:0 0 8px;font-size:20px;line-height:1.25;color:#fff;">Antes de sair, leve o guia<br><span style="color:#FFD900;white-space:nowrap;">"A&nbsp;Engrenagem"</span></h3>'
      + '  <p style="margin:0 0 18px;font-size:13.5px;line-height:1.5;color:rgba(255,255,255,.7);">O mapa das 7 peças que decidem se marketing e vendas geram receita — com autodiagnóstico e por onde começar em cada uma. Deixe seu WhatsApp real: nosso time envia o material direto por lá.</p>'
      + '</div>'
      + '<div id="lan4-isca-form" novalidate style="padding:0 24px 24px;">'
      + '  <input name="nome" autocomplete="name" placeholder="Nome" required style="width:100%;box-sizing:border-box;padding:12px 13px;margin-bottom:10px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;font-size:14px;background:rgba(255,255,255,.06);color:#fff;">'
      + '  <input name="email" type="email" autocomplete="email" placeholder="E-mail" required style="width:100%;box-sizing:border-box;padding:12px 13px;margin-bottom:10px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;font-size:14px;background:rgba(255,255,255,.06);color:#fff;">'
      + '  <input name="telefone" type="tel" autocomplete="tel-national" placeholder="WhatsApp (ex.: 11998765432)" required style="width:100%;box-sizing:border-box;padding:12px 13px;margin-bottom:6px;border:1.5px solid rgba(255,255,255,.15);border-radius:8px;font-size:14px;background:rgba(255,255,255,.06);color:#fff;">'
      + '  <div id="lan4-isca-erro" style="color:#ff8a8a;font-size:12px;min-height:16px;margin-bottom:8px;"></div>'
      + '  <p style="margin:0 0 12px;font-size:11.5px;line-height:1.4;color:rgba(255,255,255,.7);font-weight:700;">Confirme um número real de WhatsApp — é por lá que nossa equipe vai enviar o material.</p>'
      + '  <button type="button" id="lan4-isca-enviar" style="width:100%;padding:14px;background:#FFD900;color:#0A1428;border:none;border-radius:999px;font-size:15px;font-weight:800;cursor:pointer;">Quero receber no WhatsApp</button>'
      + '  <button type="button" id="lan4-isca-cancelar" style="width:100%;padding:9px;background:transparent;color:rgba(255,255,255,.5);border:none;font-size:12.5px;cursor:pointer;margin-top:4px;">Não, obrigado</button>'
      + '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var form = box.querySelector('#lan4-isca-form');
    var erroEl = box.querySelector('#lan4-isca-erro');

    function fecha() { lan4FechaModalIsca(overlay); }
    box.querySelector('#lan4-isca-x').addEventListener('click', fecha);
    box.querySelector('#lan4-isca-cancelar').addEventListener('click', fecha);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) fecha(); });
    document.addEventListener('keydown', function escFechaIsca(e) {
      if (e.key === 'Escape') { fecha(); document.removeEventListener('keydown', escFechaIsca); }
    });

    box.querySelector('#lan4-isca-enviar').addEventListener('click', function (e) {
      e.preventDefault();
      var nome = lan4CampoValor(form, 'nome');
      var email = lan4CampoValor(form, 'email');
      var telefone = lan4CampoValor(form, 'telefone');

      if (!nome) { erroEl.textContent = 'Preencha seu nome.'; return; }
      if (!email || email.indexOf('@') === -1) { erroEl.textContent = 'Preencha um e-mail válido.'; return; }
      var erroTel = lan4ValidaTelefone(telefone);
      if (erroTel) { erroEl.textContent = erroTel; return; }

      var btn = box.querySelector('#lan4-isca-enviar');
      btn.disabled = true;
      btn.textContent = 'Enviando…';

      var lead = { nome: nome, email: email, telefone: telefone };

      lan4EnviaRd(Object.assign({
        token_rdstation: 'd5d170dfe71825a3ebc37e6699f10652',
        identificador: LAN4_ISCA_IDENTIFICADOR,
        email: lead.email,
        nome: lead.nome,
        telefone: lead.telefone
      }, lan4RdUtmPayload()))
      .then(function () {
        lan4IscaPushLead(lead);
        fecha();
        window.open(lan4IscaWhatsappLink(nome.split(' ')[0]), '_blank', 'noopener');
      })
      .catch(function () {
        erroEl.textContent = 'Ocorreu um erro. Tente novamente.';
        btn.disabled = false;
        btn.textContent = 'Quero receber no WhatsApp';
      });
    });

    form.querySelector('[name="nome"]').focus();
  }

  /* ─── Gatilhos ────────────────────────────────────────────────────── */
  var LAN4_ISCA_MOBILE = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  if (!LAN4_ISCA_MOBILE) {
    /* Desktop: exit-intent — múltiplos sinais em paralelo, porque nenhum
       sozinho é confiável (limitação conhecida: em janela maximizada o
       navegador às vezes não dispara NENHUM evento de mouse quando o
       cursor sai pelo topo — o chrome do próprio navegador/SO intercepta
       o ponteiro antes do DOM ver o evento). Os listeners ficam no
       CAPTURE phase (3º argumento `true`) pra rodar antes de qualquer
       stopPropagation() de outro componente da página (ex.: o drag do
       carrossel de serviços) e nunca serem engolidos por ele.
       (1) mouseout/pointerout com clientY pequeno (raio maior, 40px —
           8px era estreito demais: no instante em que o SO/navegador
           reduz a resolução de eventos perto da borda, o cursor às vezes
           "pula" de y=30 direto pra fora sem gerar evento com y≤8);
       (2) mouseleave/pointerleave no <html>, rede de segurança pro caso
           (1) falhar — cobre navegadores que só disparam leave e nunca
           out com clientY correto;
       (3) velocidade + direção do movimento, com throttle via rAF (em
           vez de a cada pixel) — dispara se o mouse está subindo rápido
           DENTRO de uma zona mais generosa (120px do topo), cobrindo o
           caso em que o último mousemove antes de sair já não teria
           clientY pequeno o bastante nas checagens (1)/(2). */
    var LAN4_ISCA_EXIT_THRESHOLD = 40;  // px de folga a partir do topo
    var LAN4_ISCA_VELOCITY_ZONE = 120;  // px do topo onde velocidade já conta
    var LAN4_ISCA_VELOCITY_MIN = 25;    // px/frame subindo pra considerar "indo embora"

    function lan4IscaTentaAbrir() {
      if (lan4IscaJaExibido()) return;
      lan4AbreModalIsca();
    }

    document.addEventListener('mouseout', function (e) {
      if (e.clientY <= LAN4_ISCA_EXIT_THRESHOLD && (!e.relatedTarget || e.relatedTarget.nodeName === 'HTML')) {
        lan4IscaTentaAbrir();
      }
    }, true);

    document.addEventListener('pointerout', function (e) {
      if (e.clientY <= LAN4_ISCA_EXIT_THRESHOLD) lan4IscaTentaAbrir();
    }, true);

    document.documentElement.addEventListener('mouseleave', lan4IscaTentaAbrir);
    document.documentElement.addEventListener('pointerleave', lan4IscaTentaAbrir);

    /* Velocidade: throttle por rAF em vez de processar todo mousemove —
       reduz custo por frame e evita competir com outros listeners de
       mousemove/pointermove da página (ex.: drag do carrossel), o que
       também ajuda o navegador a não atrasar a entrega desses eventos.
       BUG encontrado 25/07 (relato de usuário: popup abrindo ao rolar a
       página com o mouse parado perto do topo, sem exit-intent real):
       rolar com a roda do mouse reposiciona o conteúdo sob o cursor
       parado, e isso pode dar origem a um `mousemove`/`clientY` sintético
       do navegador com valor diferente do último lido — a checagem de
       velocidade não sabia distinguir isso de um movimento real do mouse.
       Correção: ignorar a leitura corrente se um scroll aconteceu no
       mesmo frame (ou no frame imediatamente anterior) — se o usuário só
       rolou a página, não houve intenção de sair. */
    var lan4IscaUltimoY = null;
    var lan4IscaFramePendente = false;
    var lan4IscaYAtual = null;
    var lan4IscaUltimoScrollY = window.scrollY;
    var lan4IscaScrollouNesteFrame = false;

    window.addEventListener('scroll', function () {
      lan4IscaScrollouNesteFrame = true;
    }, { passive: true });

    function lan4IscaChecaVelocidade() {
      lan4IscaFramePendente = false;
      var scrollMudou = lan4IscaScrollouNesteFrame || window.scrollY !== lan4IscaUltimoScrollY;
      lan4IscaUltimoScrollY = window.scrollY;
      lan4IscaScrollouNesteFrame = false;
      if (lan4IscaJaExibido() || lan4IscaYAtual === null) return;
      if (lan4IscaUltimoY !== null && !scrollMudou) {
        var subindoRapido = (lan4IscaUltimoY - lan4IscaYAtual) >= LAN4_ISCA_VELOCITY_MIN;
        if (subindoRapido && lan4IscaYAtual <= LAN4_ISCA_VELOCITY_ZONE) {
          lan4IscaTentaAbrir();
        }
      }
      lan4IscaUltimoY = lan4IscaYAtual;
    }

    document.addEventListener('mousemove', function (e) {
      if (lan4IscaJaExibido()) return;
      lan4IscaYAtual = e.clientY;
      if (!lan4IscaFramePendente) {
        lan4IscaFramePendente = true;
        requestAnimationFrame(lan4IscaChecaVelocidade);
      }
    }, { passive: true, capture: true });

    /* (4) window.blur — sinal independente dos três acima, não depende de
       capturar a posição/velocidade exata do mouse em nenhum momento.
       Dispara quando a janela perde o foco (clicou na barra de abas, na
       barra de endereço, trocou de app/monitor) — é o gatilho mais
       confiável tecnicamente porque o navegador SEMPRE reporta blur/focus
       corretamente ao SO, mesmo quando engole eventos de mouse. Delay de
       1.2s antes de disparar: evita falso positivo de alt-tab rápido só
       pra checar notificação e já voltar (prática recomendada de mercado:
       ideal é ativar após 1–2s de blur real, não imediatamente). Só conta
       blur da JANELA (não de elementos internos como inputs/botões, que
       também disparam blur mas não significam "saiu do site"). */
    var lan4IscaBlurTimer = null;
    window.addEventListener('blur', function () {
      if (lan4IscaJaExibido()) return;
      lan4IscaBlurTimer = setTimeout(function () {
        if (document.hidden || !document.hasFocus()) lan4AbreModalIsca();
      }, 1200);
    });
    window.addEventListener('focus', function () {
      if (lan4IscaBlurTimer) { clearTimeout(lan4IscaBlurTimer); lan4IscaBlurTimer = null; }
    });

    /* (5) Inatividade prolongada — sinal recomendado pelas ferramentas
       atuais de exit-intent como rede de segurança final: se a pessoa
       para de interagir (mouse, teclado, scroll, touch) por um tempo
       longo, é provável que tenha "saído mentalmente" mesmo sem fechar
       a aba. 45s é conservador o bastante pra não confundir com alguém
       lendo o conteúdo com calma. */
    var LAN4_ISCA_IDLE_MS = 45000;
    var lan4IscaIdleTimer = null;
    function lan4IscaResetIdle() {
      if (lan4IscaJaExibido()) return;
      clearTimeout(lan4IscaIdleTimer);
      lan4IscaIdleTimer = setTimeout(lan4IscaTentaAbrir, LAN4_ISCA_IDLE_MS);
    }
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (evt) {
      window.addEventListener(evt, lan4IscaResetIdle, { passive: true });
    });
    lan4IscaResetIdle();
  } else {
    /* Mobile: sem exit-intent confiável (visibilitychange/pagehide só
       disparam depois que a pessoa já saiu — tarde demais pra mostrar UI).
       Dispara em tempo fixo, sem exigir scroll (exigir scroll faria o
       pop-up nunca aparecer pra quem sai cedo, que é justamente quem mais
       precisa ver o material antes de ir embora). Delay alinhado à faixa
       de mercado pra gatilhos proativos (8–15s: cedo o suficiente pra não
       perder quem sai rápido, tarde o suficiente pra não ser visto como
       spam antes da pessoa se orientar na página). */
    setTimeout(function () {
      lan4AbreModalIsca();
    }, LAN4_ISCA_MOBILE_DELAY_MS);
  }
})();
