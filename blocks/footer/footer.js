/**
 * Footer Block — AEM Edge Delivery Services
 *
 * Contract: EDS-COMP-004 (.eds-pipeline/contracts/footer.md)
 * Base: boilerplate footer (loads the /footer fragment), styled after the portal
 * Model: xwalk (EDS + Universal Editor). No _footer.json: the boilerplate footer has none and
 *   the contract (§5) adds no fields. Authors edit the /footer page with the default content
 *   models (section, title, text, image).
 * UE instrumentation: Completado (Fase 3)
 * QA audit: Validado
 *
 * QA Changes:
 * - The image paragraph of each principle is dropped when its picture moves into the card:
 *   its data-aue-* / data-richtext-* move to the card (moveInstrumentation).
 * - Universal Editor fallback instrumentation (instrumentFallback): only when AEM delivered the
 *   fragment without instrumentation, never over the attributes AEM delivers.
 * - Empty style="" left by loadSection() on the fragment sections is removed (orchestrator
 *   decision); inline styles with a value are never touched.
 * - A missing fragment leaves the footer empty instead of throwing.
 */

// Note [EDS-COMP-004, EDS-FIX-002]: the portal's hover (--link-hover-color-on-dark) is in
// footer.css and its focus ring (--focus-ring-width/-color) is the global one of styles.css.

import { getMetadata } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/** Universal Editor labels of the fallback instrumentation (DH-06: single place to translate). */
const UE_LABELS = {
  section: 'Sección del pie',
  title: 'Título',
  text: 'Texto',
  image: 'Imagen',
};

let panelCount = 0;

/**
 * An authored image on its own: a bare <picture>, or a paragraph that only holds one.
 * @param {Element|null} element
 * @returns {boolean}
 */
function isPicture(element) {
  if (!element) return false;
  if (element.tagName === 'PICTURE') return true;
  return element.tagName === 'P'
    && element.children.length === 1
    && element.firstElementChild.tagName === 'PICTURE'
    && !element.textContent.trim();
}

/**
 * A list whose links are all icons (`:instagram:` and friends) is the social list.
 * @param {Element} list
 * @returns {boolean}
 */
function isSocialList(list) {
  const links = [...list.querySelectorAll(':scope > li > a')];
  return links.length > 0 && links.every((link) => link.querySelector('.icon'));
}

/**
 * Keeps the authored label of each social link as its accessible name, out of sight.
 * @param {Element} list
 */
function decorateSocial(list) {
  list.classList.add('footer-social');
  list.querySelectorAll(':scope > li > a').forEach((link) => {
    [...link.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
      .forEach((node) => {
        const label = document.createElement('span');
        label.className = 'footer-social-label';
        node.before(label);
        label.append(node);
      });
  });
}

/**
 * Turns one group of principles into a row of image cards; each card discloses its text
 * in a panel placed after the row.
 * @param {Element} wrapper The section's default content wrapper
 * @param {Array<{picture: Element, details: Element[]}>} items
 */
function buildPrinciplesGroup(wrapper, items) {
  const list = document.createElement('ul');
  list.className = 'footer-principles-list';
  wrapper.append(list);

  const toggles = [];
  items.forEach(({ picture, details }) => {
    const card = document.createElement('li');
    list.append(card);
    const image = picture.tagName === 'PICTURE' ? picture : picture.querySelector('picture');

    if (!details.length) {
      card.append(image);
      if (image !== picture) {
        moveInstrumentation(picture, card);
        picture.remove();
      }
      return;
    }

    panelCount += 1;
    const panel = document.createElement('div');
    panel.className = 'footer-principles-panel';
    panel.id = `footer-principles-panel-${panelCount}`;
    panel.hidden = true;
    panel.append(...details);
    wrapper.append(panel);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'footer-principles-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', panel.id);
    const heading = panel.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) {
      heading.id = heading.id || `${panel.id}-title`;
      toggle.setAttribute('aria-labelledby', heading.id);
    }
    toggle.append(image);
    if (image !== picture) {
      moveInstrumentation(picture, card);
      picture.remove();
    }
    card.append(toggle);
    toggles.push({ toggle, panel });
  });

  toggles.forEach(({ toggle, panel }) => {
    toggle.addEventListener('click', () => {
      const opening = toggle.getAttribute('aria-expanded') !== 'true';
      toggles.forEach((other) => {
        other.toggle.setAttribute('aria-expanded', 'false');
        other.panel.hidden = true;
      });
      toggle.setAttribute('aria-expanded', String(opening));
      panel.hidden = !opening;
    });
  });
}

/**
 * Principles band: each image starts an item and the content after it, up to the next image,
 * is its text. The first item is the full-width claim; the rest share one row.
 * @param {Element} wrapper The section's default content wrapper
 */
function decoratePrinciples(wrapper) {
  const items = [];
  [...wrapper.children].forEach((element) => {
    if (isPicture(element)) items.push({ picture: element, details: [] });
    else if (items.length) items[items.length - 1].details.push(element);
  });
  buildPrinciplesGroup(wrapper, items.slice(0, 1));
  if (items.length > 1) buildPrinciplesGroup(wrapper, items.slice(1));
}

/**
 * Names each fragment section after the job its default content does.
 * @param {Element} section
 */
function decorateSection(section) {
  const wrapper = section.querySelector(':scope > .default-content-wrapper');
  if (!wrapper) return;

  if (isPicture(wrapper.firstElementChild)) {
    section.classList.add('footer-principles');
    decoratePrinciples(wrapper);
    return;
  }

  const lists = [...wrapper.querySelectorAll(':scope > ul')];
  const social = lists.find(isSocialList);
  if (social) {
    section.classList.add('footer-bottom');
    decorateSocial(social);
    lists.filter((list) => list !== social).forEach((list) => list.classList.add('footer-legal'));
    wrapper.querySelectorAll(':scope > p').forEach((paragraph) => {
      if (isPicture(paragraph)) paragraph.classList.add('footer-logo');
      else paragraph.classList.add('footer-copyright');
    });
    return;
  }

  if (lists.length && wrapper.querySelector(':scope > :is(h1, h2, h3, h4, h5, h6)')) {
    section.classList.add('footer-directory');
  }
}

/**
 * Fallback instrumentation for Universal Editor. When the page is opened in the editor, AEM
 * delivers the fragment with the data-aue-* / data-richtext-* of its sections and default
 * content, and the decoration keeps them (moveInstrumentation): those always win. This only
 * runs when the fragment arrives with none, mirrors the default content models (section,
 * title, text, image) and never overwrites an attribute. The resource is the fragment page,
 * resolved at runtime, because the footer content belongs to it and not to the current page.
 * @param {Element} footer The element holding the fragment sections, before decoration
 * @param {string} footerPath Path of the fragment page
 */
function instrumentFallback(footer, footerPath) {
  if (footer.querySelector('[data-aue-resource], [data-richtext-resource], [data-richtext-prop]')) return;
  const base = `urn:aemconnection:${footerPath}`;
  const set = (element, values) => {
    if (!element) return;
    Object.entries(values).forEach(([key, value]) => {
      if (!element.dataset[key]) element.dataset[key] = value;
    });
  };

  footer.querySelectorAll(':scope > .section').forEach((section, index) => {
    const sectionResource = `${base}#section-${index}`;
    set(section, {
      aueResource: sectionResource,
      aueType: 'container',
      aueModel: 'section',
      aueFilter: 'section',
      aueLabel: `${UE_LABELS.section} ${index + 1}`,
      aueBehavior: 'component',
    });

    const wrapper = section.querySelector(':scope > .default-content-wrapper');
    [...(wrapper?.children || [])].forEach((element, position) => {
      const resource = `${sectionResource}-item-${position}`;
      if (isPicture(element)) {
        set(element, {
          aueResource: resource, aueType: 'component', aueModel: 'image', aueLabel: UE_LABELS.image, aueBehavior: 'component',
        });
        set(element.querySelector('img'), { aueProp: 'image', aueType: 'media', aueLabel: UE_LABELS.image });
      } else if (/^H[1-6]$/.test(element.tagName)) {
        set(element, {
          aueResource: resource, aueType: 'text', aueModel: 'title', aueProp: 'title', aueLabel: UE_LABELS.title, aueBehavior: 'component',
        });
      } else {
        set(element, {
          aueResource: resource, aueType: 'richtext', aueProp: 'text', aueLabel: UE_LABELS.text, aueBehavior: 'component',
        });
      }
    });
  });
}

/**
 * Loads the footer fragment and decorates its sections.
 * @param {Element} block The footer block element
 */
async function loadFooter(block) {
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  const fragment = await loadFragment(footerPath);

  // decorate footer DOM (boilerplate: the block holds no authored content, only the fragment)
  block.textContent = '';
  if (!fragment) return;
  const footer = document.createElement('div');
  while (fragment.firstElementChild) footer.append(fragment.firstElementChild);

  const sections = footer.querySelectorAll(':scope > .section');
  // loadSection() leaves an empty style="" behind once it shows each section: drop only those.
  sections.forEach((section) => {
    if (section.hasAttribute('style') && !section.getAttribute('style').trim()) {
      section.removeAttribute('style');
    }
  });
  instrumentFallback(footer, footerPath);
  sections.forEach(decorateSection);

  block.append(footer);
}

/**
 * Footer of the site, authored as the /footer fragment.
 *
 * DOM de entrada (fragmento /footer, contenido por defecto en cada sección):
 *   section            picture · h3 · p…  (claim, a ancho completo)
 *                      picture · h3 · p…  ×N (principios, en fila)
 *   section (dark)     h2 · ul > li > a   (enlaces de escuelas)
 *   section (dark)     ul > li > a        (legales)
 *                      ul > li > a > span.icon + texto   (redes; el texto es el nombre accesible)
 *                      p                  (copyright)
 *                      p > picture        (logotipo)
 *
 * @param {Element} block The footer block element
 * @returns {Promise<void>} resolves when the fragment is in place
 */
export default function decorate(block) {
  return loadFooter(block);
}
