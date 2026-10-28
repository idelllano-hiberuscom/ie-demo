/*
 * Header Block — AEM Edge Delivery Services
 *
 * Model: xwalk (EDS + Universal Editor)
 * UE instrumentation: completed (Fase 3). The header has no _header.json, like the
 * boilerplate: its content is the /nav page, which authors edit as a page of its own in
 * Universal Editor with the default content models (text, title, image, button).
 * QA audit: validated (EDS-COMP-003)
 *
 * QA Changes:
 * - Brand logos: the paragraph a DAM picture is moved out of keeps no orphan instrumentation;
 *   its data-aue-* / data-richtext-* go with the picture (moveInstrumentation) and the
 *   emptied paragraph is removed (it was left as an empty <p> in nav-brand).
 * - Universal Editor fallback instrumentation (instrumentFallback): only when AEM has not
 *   instrumented anything, and never over an attribute AEM delivers.
 */

import { getMetadata, toCamelCase } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/** Labels shown to authors in Universal Editor (fallback instrumentation only). */
const UE_LABELS = {
  block: 'Cabecera (fragmento nav)',
  logo: 'Logotipo',
  navigation: 'Navegación principal',
};

// media query match that indicates mobile/tablet width (contract §3b: 900px)
const isDesktop = window.matchMedia('(min-width: 900px)');

/**
 * Fallback labels, used only when the site placeholders do not define the keys.
 * The site text lives in /placeholders.json (keys navMenu, navBack and skipToContent).
 */
const DEFAULT_LABELS = {
  navMenu: 'Menu',
  navBack: 'Back',
  skipToContent: 'Skip to main content',
};

const SCROLL_TOLERANCE = 5;

let idCount = 0;

/**
 * Returns a unique id for aria-controls.
 * @param {string} prefix
 * @returns {string}
 */
function nextId(prefix) {
  idCount += 1;
  return `${prefix}-${idCount}`;
}

let placeholdersRequest;

/**
 * Fetches the site placeholders once (/placeholders.json, rows Key/Text) and
 * returns them keyed both as written and in camelCase: toCamelCase lowercases
 * camelCase keys (navMenu -> navmenu), so the raw key must stay readable.
 * Any failure resolves to an empty object.
 * @returns {Promise<Object<string, string>>} placeholders
 */
function fetchPlaceholders() {
  if (!placeholdersRequest) {
    placeholdersRequest = fetch('/placeholders.json')
      .then((response) => (response.ok ? response.json() : {}))
      .then((json) => Object.fromEntries((json.data || [])
        .filter((row) => row.Key && row.Text)
        .flatMap((row) => [[toCamelCase(row.Key), row.Text], [row.Key, row.Text]])))
      .catch(() => ({}));
  }
  return placeholdersRequest;
}

/**
 * Creates a button with the attributes shared by every disclosure of the nav.
 * @param {string} className
 * @param {string} controls id of the controlled element
 * @returns {HTMLButtonElement}
 */
function createToggle(className, controls) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', controls);
  return button;
}

/**
 * Moves the loose text nodes of an element into a span, so CSS can show or hide them.
 * @param {Element} element
 * @param {string} className
 */
function wrapLooseText(element, className) {
  [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    .forEach((node) => {
      const span = document.createElement('span');
      span.className = className;
      node.before(span);
      span.append(node);
    });
}

/**
 * Whether a link points to the current page.
 * @param {HTMLAnchorElement} link
 * @returns {boolean}
 */
function isCurrentPage(link) {
  try {
    return new URL(link.href, window.location).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

/**
 * Visible, focusable elements inside a container, in DOM order.
 * @param {Element} container
 * @returns {Element[]}
 */
function getFocusable(container) {
  return [...container.querySelectorAll('a[href], button:not([disabled])')]
    .filter((el) => el.getClientRects().length > 0);
}

/**
 * Collapses a disclosure button.
 * @param {Element} button
 */
function collapse(button) {
  button.setAttribute('aria-expanded', 'false');
}

/**
 * Collapses every level-3 panel inside a scope.
 * @param {Element} scope
 */
function closeSubs(scope) {
  scope.querySelectorAll('.nav-sub-toggle[aria-expanded="true"]').forEach(collapse);
}

/**
 * Opens or closes a level-3 panel. On mobile it covers the drawer and takes the focus.
 * @param {HTMLButtonElement} toggle
 * @param {boolean} [force]
 */
function toggleSub(toggle, force) {
  const expand = force ?? toggle.getAttribute('aria-expanded') !== 'true';
  closeSubs(toggle.closest('.nav-subs'));
  toggle.setAttribute('aria-expanded', expand ? 'true' : 'false');
  if (expand && !isDesktop.matches) {
    document.getElementById(toggle.getAttribute('aria-controls'))
      .querySelector('.nav-back').focus();
  }
}

/**
 * Opens or closes a level-1 entry: accordion on mobile, mega menu on desktop.
 * @param {Element} nav
 * @param {HTMLButtonElement} toggle
 * @param {boolean} [force]
 */
function toggleEntry(nav, toggle, force) {
  const expand = force ?? toggle.getAttribute('aria-expanded') !== 'true';
  nav.querySelectorAll('.nav-entry-toggle[aria-expanded="true"]').forEach((open) => {
    collapse(open);
    closeSubs(open.parentElement);
  });
  toggle.setAttribute('aria-expanded', expand ? 'true' : 'false');
  if (expand && isDesktop.matches) {
    // the portal shows the first subsection of the mega menu already open
    const first = toggle.parentElement.querySelector('.nav-sub-toggle');
    if (first) toggleSub(first, true);
  }
  nav.closest('.nav-wrapper').classList.toggle('has-panel', expand && isDesktop.matches);
}

/**
 * Closes every open entry of the nav.
 * @param {Element} nav
 */
function closeEntries(nav) {
  const open = nav.querySelector('.nav-entry-toggle[aria-expanded="true"]');
  if (open) toggleEntry(nav, open, false);
}

/**
 * Opens or closes the mobile drawer.
 * @param {Element} nav
 * @param {boolean} [force]
 */
function toggleMenu(nav, force) {
  const wrapper = nav.closest('.nav-wrapper');
  const button = nav.querySelector('.nav-hamburger button');
  const open = force ?? !wrapper.classList.contains('is-open');
  wrapper.classList.toggle('is-open', open && !isDesktop.matches);
  button.setAttribute('aria-expanded', open && !isDesktop.matches ? 'true' : 'false');
  document.body.style.overflowY = open && !isDesktop.matches ? 'hidden' : '';
  if (!open) closeEntries(nav);
}

/**
 * Keeps the keyboard focus inside the open drawer, or inside the open level-3 panel.
 * @param {KeyboardEvent} e
 * @param {Element} nav
 */
function trapFocus(e, nav) {
  const subPanel = nav.querySelector('.nav-sub-toggle[aria-expanded="true"] + .nav-sub-panel');
  const focusable = getFocusable(subPanel || nav);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  } else if (!focusable.includes(document.activeElement)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Escape closes the innermost open layer and returns the focus to its trigger.
 * @param {KeyboardEvent} e
 * @param {Element} nav
 */
function onKeydown(e, nav) {
  const wrapper = nav.closest('.nav-wrapper');
  if (e.key === 'Tab' && wrapper.classList.contains('is-open')) {
    trapFocus(e, nav);
    return;
  }
  if (e.key !== 'Escape') return;
  const openSub = nav.querySelector('.nav-sub-toggle[aria-expanded="true"]');
  const openEntry = nav.querySelector('.nav-entry-toggle[aria-expanded="true"]');
  if (openSub && !isDesktop.matches) {
    toggleSub(openSub, false);
    openSub.focus();
  } else if (wrapper.classList.contains('is-open')) {
    toggleMenu(nav, false);
    nav.querySelector('.nav-hamburger button').focus();
  } else if (openEntry) {
    toggleEntry(nav, openEntry, false);
    openEntry.focus();
  }
}

/**
 * Logo: the home link holds the logos (DAM pictures or :icon: notation) and its text stays
 * for screen readers. The first logo is the full one, the second the round one shown in
 * the compact bar after scrolling on mobile.
 * @param {Element} navBrand
 */
function decorateBrand(navBrand) {
  const link = navBrand.querySelector('a[href]');
  const logos = [...navBrand.querySelectorAll('picture, .icon, img')]
    .filter((el) => !el.parentElement.closest('picture, .icon'));
  if (link) {
    link.className = '';
    const wrapper = link.closest('.button-wrapper');
    if (wrapper) wrapper.className = '';
    if (logos.length) wrapLooseText(link, 'nav-brand-label');
    logos.filter((logo) => !link.contains(logo)).reverse().forEach((logo) => {
      const source = logo.parentElement;
      link.prepend(logo);
      // a DAM picture comes in a paragraph of its own: once emptied, its instrumentation
      // goes with the picture and the empty paragraph leaves the brand
      if (source?.matches('p') && !source.children.length && !source.textContent.trim()) {
        moveInstrumentation(source, logo);
        source.remove();
      }
    });
  }
  logos.slice(0, 2).forEach((logo, i) => {
    logo.classList.add(i === 0 ? 'nav-logo' : 'nav-logo-compact');
    const img = logo.tagName === 'IMG' ? logo : logo.querySelector('img');
    if (img) img.loading = 'eager';
  });
}

/**
 * Utility link of a level-2 panel: icon, optional lead-in text and link.
 * @param {Element} item
 */
function decorateUtil(item) {
  item.classList.add('nav-util');
  wrapLooseText(item, 'nav-util-lead');
}

/**
 * Subsection of a level-2 panel. With children it opens a level-3 panel.
 * @param {Element} item
 * @param {Object<string, string>} labels
 */
function decorateSub(item, labels) {
  item.classList.add('nav-sub');
  const children = item.querySelector(':scope > ul');
  if (!children) return;

  const labelNodes = [...item.childNodes].filter((node) => node !== children);
  const text = labelNodes.map((node) => node.textContent).join('').trim();
  const panel = document.createElement('div');
  panel.className = 'nav-sub-panel';
  panel.id = nextId('nav-sub');
  const toggle = createToggle('nav-sub-toggle', panel.id);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'nav-back';
  back.textContent = labels.navBack;

  const title = document.createElement('p');
  title.className = 'nav-sub-title';
  const linked = labelNodes.some((node) => node.nodeType === Node.ELEMENT_NODE
    && (node.matches('a') || node.querySelector('a')));
  if (linked) {
    // a linked label keeps its link in the panel title; the toggle only carries its text
    toggle.textContent = text;
    title.append(...labelNodes);
  } else {
    toggle.append(...labelNodes);
    title.textContent = text;
  }
  children.classList.add('nav-sub-links');
  panel.append(back, title, children);
  item.append(toggle, panel);

  back.addEventListener('click', () => {
    toggleSub(toggle, false);
    toggle.focus();
  });
  toggle.addEventListener('click', () => toggleSub(toggle));
  toggle.addEventListener('mouseenter', () => {
    if (isDesktop.matches) toggleSub(toggle, true);
  });
}

/**
 * Level-1 entry: a disclosure button and its level-2 panel.
 * @param {Element} nav
 * @param {Element} entry
 * @param {Object<string, string>} labels
 */
function decorateEntry(nav, entry, labels) {
  entry.classList.add('nav-entry');
  const sublist = entry.querySelector(':scope > ul');
  if (!sublist) return;

  const panel = document.createElement('div');
  panel.className = 'nav-entry-panel';
  panel.id = nextId('nav-panel');
  const toggle = createToggle('nav-entry-toggle', panel.id);
  const text = document.createElement('span');
  text.className = 'nav-entry-label';
  text.append(...[...entry.childNodes].filter((node) => node !== sublist));
  toggle.append(text);

  const goto = document.createElement('ul');
  goto.className = 'nav-goto';
  const utils = document.createElement('ul');
  utils.className = 'nav-utils';
  sublist.classList.add('nav-subs');
  [...sublist.children].forEach((item) => {
    // Universal Editor wraps each item in a paragraph: its content is read as if it were bare
    item.querySelectorAll(':scope > p').forEach((paragraph) => {
      paragraph.before(...paragraph.childNodes);
      paragraph.remove();
    });
    // the "Go to … page" link (em > a) arrives turned into a button by decorateButtons
    const isGoto = item.querySelector(':scope > a.button.secondary');
    item.querySelector(':scope > a.button')?.classList.remove('button', 'primary', 'secondary');
    if (isGoto || item.querySelector(':scope > em > a')) {
      goto.append(item);
    } else if (item.querySelector(':scope > img, :scope > picture, :scope > .icon')) {
      decorateUtil(item);
      utils.append(item);
    } else {
      decorateSub(item, labels);
    }
  });
  if (goto.children.length) panel.append(goto);
  panel.append(sublist);
  if (utils.children.length) panel.append(utils);
  entry.append(toggle, panel);

  toggle.addEventListener('click', () => toggleEntry(nav, toggle));
}

/**
 * Tools section: CTA, service links, search, social links, languages and the chat icon.
 * Lists are recognised by their shape; of the linked paragraphs, the first is the search.
 * @param {Element} nav
 * @param {Element} navTools
 */
function decorateTools(nav, navTools) {
  const cta = navTools.querySelector('.button-wrapper');
  if (cta) {
    const ctaWrapper = document.createElement('div');
    ctaWrapper.className = 'nav-cta';
    ctaWrapper.append(cta);
    const navSections = nav.querySelector('.nav-sections');
    if (navSections) navSections.before(ctaWrapper);
    else navTools.before(ctaWrapper);
  }

  navTools.querySelectorAll(':scope .default-content-wrapper > ul').forEach((list) => {
    const items = [...list.children];
    if (items.some((item) => !item.querySelector('a'))) {
      list.classList.add('nav-lang');
    } else if (items.every((item) => item.querySelector('a img, a .icon'))) {
      list.classList.add('nav-social');
      list.querySelectorAll('a').forEach((link) => wrapLooseText(link, 'nav-social-label'));
    } else {
      list.classList.add('nav-service');
    }
  });

  // the first linked paragraph is the search box, a later one the chat icon of the top bar
  [...navTools.querySelectorAll(':scope .default-content-wrapper > p')]
    .filter((paragraph) => paragraph.querySelector('a[href]'))
    .forEach((paragraph, i) => {
      const link = paragraph.querySelector('a[href]');
      paragraph.classList.add(i === 0 ? 'nav-search' : 'nav-bot');
      wrapLooseText(link, i === 0 ? 'nav-search-label' : 'nav-bot-label');
    });
}

/**
 * Hide on scroll down, show on scroll up, as the portal's headroom does.
 * @param {Element} header the <header> element
 * @param {Element} wrapper
 */
function initHeadroom(header, wrapper) {
  let lastY = window.scrollY;
  let ticking = false;

  const update = () => {
    ticking = false;
    const y = window.scrollY;
    const delta = y - lastY;
    if (wrapper.classList.contains('is-open') || Math.abs(delta) < SCROLL_TOLERANCE) {
      if (wrapper.classList.contains('is-open')) lastY = y;
      return;
    }
    const threshold = Math.max(header.offsetHeight, wrapper.offsetHeight);
    if (y <= 0) {
      wrapper.classList.remove('is-fixed', 'is-pinned', 'is-unpinned', 'is-animated');
    } else if (delta > 0 && y > threshold) {
      if (!wrapper.classList.contains('is-fixed')) {
        wrapper.classList.add('is-fixed');
        window.requestAnimationFrame(() => wrapper.classList.add('is-animated'));
      }
      wrapper.classList.remove('is-pinned');
      wrapper.classList.add('is-unpinned');
      const nav = wrapper.querySelector('nav');
      if (nav) closeEntries(nav);
    } else if (delta < 0 && wrapper.classList.contains('is-fixed')) {
      wrapper.classList.remove('is-unpinned');
      wrapper.classList.add('is-pinned');
    }
    lastY = y;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }, { passive: true });
}

/**
 * Fallback instrumentation for Universal Editor. The header content is the /nav page,
 * which authors edit as a page of its own; when AEM delivers the fragment instrumented,
 * those attributes travel with the nodes decorate() moves (moveInstrumentation where a
 * wrapper is dropped) and always win. In the editor (main instrumented) nothing is added,
 * so no unresolvable resource shows up in the page. Off the editor (local drafts,
 * preview) the block gets a resource built from the current path and the default content
 * fields it renders: the main navigation (text component, richtext) and the DAM logo
 * (image component). There is no header model to point at, as in the boilerplate.
 * @param {Element} block The header block element
 */
function instrumentFallback(block) {
  if (document.querySelector('main[data-aue-resource]')
    || block.querySelector('[data-aue-resource], [data-aue-prop], [data-richtext-prop]')) return;

  const set = (element, values) => {
    if (!element) return;
    Object.entries(values).forEach(([key, value]) => {
      if (!element.dataset[key]) element.dataset[key] = value;
    });
  };

  set(block, {
    aueResource: `urn:aemconnection:${window.location.pathname}#header`,
    aueType: 'component',
    aueLabel: UE_LABELS.block,
  });
  set(block.querySelector('.nav-brand picture.nav-logo img, .nav-brand img.nav-logo'), {
    aueProp: 'image',
    aueType: 'media',
    aueLabel: UE_LABELS.logo,
  });
  set(block.querySelector('.nav-sections .default-content-wrapper > ul'), {
    aueProp: 'text',
    aueType: 'richtext',
    aueLabel: UE_LABELS.navigation,
  });
}

/**
 * Loads the nav fragment and builds the header.
 * @param {Element} block The header block element
 */
async function buildHeader(block) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const [fragment, placeholders] = await Promise.all([loadFragment(navPath), fetchPlaceholders()]);
  if (!fragment) return;
  const labels = Object.fromEntries(Object.entries(DEFAULT_LABELS)
    .map(([key, fallback]) => [key, placeholders[key] || fallback]));

  const nav = document.createElement('nav');
  nav.id = 'nav';
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);

  const classes = ['brand', 'sections', 'tools'];
  classes.forEach((c, i) => {
    const section = nav.children[i];
    if (!section) return;
    section.classList.add(`nav-${c}`);
    // loadSections leaves an empty style attribute behind once the section is shown
    if (!section.getAttribute('style')) section.removeAttribute('style');
  });

  const navBrand = nav.querySelector('.nav-brand');
  if (navBrand) decorateBrand(navBrand);

  const navSections = nav.querySelector('.nav-sections');
  if (navSections) {
    navSections.querySelectorAll(':scope .default-content-wrapper > ul > li')
      .forEach((entry) => decorateEntry(nav, entry, labels));
  }

  const navTools = nav.querySelector('.nav-tools');
  if (navTools) decorateTools(nav, navTools);

  nav.querySelectorAll('a[href]').forEach((link) => {
    if (isCurrentPage(link)) link.setAttribute('aria-current', 'page');
  });

  // hamburger for mobile
  const hamburger = document.createElement('div');
  hamburger.className = 'nav-hamburger';
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-controls', 'nav');
  button.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  icon.className = 'nav-hamburger-icon';
  const text = document.createElement('span');
  text.className = 'nav-hamburger-label';
  text.textContent = labels.navMenu;
  button.append(icon, text);
  hamburger.append(button);
  // after the logo, so the focus order follows the visual order of the closed bar
  if (navBrand) navBrand.after(hamburger);
  else nav.prepend(hamburger);
  button.addEventListener('click', () => toggleMenu(nav));

  const main = document.querySelector('main');
  const skip = document.createElement('a');
  skip.className = 'nav-skip';
  skip.textContent = labels.skipToContent;
  if (main) {
    if (!main.id) main.id = 'main';
    skip.href = `#${main.id}`;
  }

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(...(main ? [skip] : []), nav);
  block.append(navWrapper);
  instrumentFallback(block);

  // over a hero the closed mobile header is transparent (contract §7)
  const header = block.closest('header');
  if (main && main.querySelector(':scope > .section:first-child .hero')) {
    header.classList.add('is-overlay');
  }

  window.addEventListener('keydown', (e) => onKeydown(e, nav));
  nav.addEventListener('focusout', (e) => {
    if (isDesktop.matches && !nav.contains(e.relatedTarget)) closeEntries(nav);
  });
  document.addEventListener('click', (e) => {
    if (isDesktop.matches && !nav.contains(e.target)) closeEntries(nav);
  });
  isDesktop.addEventListener('change', () => toggleMenu(nav, false));

  initHeadroom(header, navWrapper);
}

/**
 * Header block: loads the /nav fragment (boilerplate contract) and decorates it.
 *
 * DOM de entrada (fragmento /nav, contrato §3b):
 *   section 1 → nav-brand    : link to the home page with the full logo and, optionally, the
 *                              round one (:icon: notation or DAM pictures before the link)
 *   section 2 → nav-sections : ul > li (entry label)
 *                                ul > li  em > a          → "Go to … page" link
 *                                ul > li  label + ul      → subsection with level-3 links
 *                                ul > li  a               → subsection link
 *                                ul > li  :icon: + text + a → utility link
 *   section 3 → nav-tools    : p > em > a (CTA), ul of service links, p > a :icon: + text (search),
 *                              ul of :icon: + name links (social), ul with one unlinked item
 *                              (languages), a second p > a :icon: + name (chat icon)
 *
 * @param {Element} block - Root element of the block
 * @returns {Promise<void>} resolves when the nav is in place, so the block status stays accurate
 */
export default function decorate(block) {
  return buildHeader(block);
}
