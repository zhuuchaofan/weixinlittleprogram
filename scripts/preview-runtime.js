// 轻量原生模板适配器，复用实际页面逻辑；开发测试专用，不进入小程序包。
const definitions = {};
let currentPage;
let spec;
let registerName;
let toastTimer;
const clone = (value) => JSON.parse(JSON.stringify(value));
const showToast = ({ title }) => {
  document.querySelector('#toast').textContent = title;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    document.querySelector('#toast').textContent = '';
  }, 2500);
};
window.wx = {
  cloud: {
    init() {},
    async getTempFileURL({ fileList }) {
      return {
        fileList: fileList.map((fileID) => ({
          fileID,
          tempFileURL:
            'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        })),
      };
    },
  },
  getStorageSync(key) {
    return JSON.parse(localStorage.getItem(key) || 'null');
  },
  setStorageSync(key, value) {
    if (window.__failStorage) throw new Error('测试存储失败');
    localStorage.setItem(key, JSON.stringify(value));
  },
  removeStorageSync(key) {
    localStorage.removeItem(key);
  },
  nextTick(fn) {
    queueMicrotask(fn);
  },
  navigateTo({ url }) {
    location.hash = url.split('/')[2];
  },
  reLaunch({ url }) {
    location.hash = url.split('/')[2];
  },
  showToast,
  async showModal({ title, content }) {
    return { confirm: window.confirm(title + '\n' + content) };
  },
  setClipboardData({ data, fail }) {
    navigator.clipboard
      .writeText(data)
      .then(() => showToast({ title: '地址已复制' }))
      .catch(fail);
  },
  openLocation({ fail }) {
    fail();
  },
  previewImage({ urls, current }) {
    let index = Math.max(0, urls.indexOf(current));
    const layer = document.createElement('div');
    layer.className = 'preview-dialog';
    layer.setAttribute('role', 'dialog');
    const img = document.createElement('img');
    const count = document.createElement('p');
    const footer = document.createElement('footer');
    function refresh() {
      img.src = urls[index];
      count.textContent = `${index + 1} / ${urls.length} · 占位图仅用于演示`;
    }
    for (const [label, fn] of [
      [
        '上一张',
        () => {
          index = (index - 1 + urls.length) % urls.length;
          refresh();
        },
      ],
      ['关闭', () => layer.remove()],
      [
        '下一张',
        () => {
          index = (index + 1) % urls.length;
          refresh();
        },
      ],
    ]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = fn;
      footer.append(button);
    }
    layer.append(img, count, footer);
    document.body.append(layer);
    refresh();
  },
};
function instance(def, data, update) {
  const owner = {
    ...def,
    data: clone(data || {}),
    setData(patch) {
      Object.assign(this.data, patch);
      update();
    },
  };
  for (const [name, method] of Object.entries(def.methods || {}))
    owner[name] = method;
  return owner;
}
window.Page = (def) => {
  currentPage = instance(def, def.data, renderPage);
  window.__page = currentPage;
};
window.Component = (def) => {
  definitions[registerName] = def;
};
function evaluate(text, context) {
  if (!text) return '';
  const single = text.match(/^{{([^{}]*)}}$/);
  const run = (expression) =>
    Function('scope', `with(scope) { return (${expression}); }`)(context);
  return single
    ? run(single[1])
    : text.replace(/{{([\s\S]*?)}}/g, (_, exp) => String(run(exp) ?? ''));
}
function parse(source) {
  const xml = source
    .replace(/wx:else(?=\s|>)/g, 'wx:else=""')
    .replace(/{{[\s\S]*?}}/g, (binding) =>
      binding.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    );
  const doc = new DOMParser().parseFromString(
    `<root xmlns:wx="wx" xmlns:bind="bind">${xml}</root>`,
    'application/xml',
  );
  if (doc.querySelector('parsererror'))
    throw new Error(doc.querySelector('parsererror').textContent);
  return doc.documentElement;
}
function renderChildren(nodes, parent, context, owner, path) {
  let branch = false;
  [...nodes].forEach((node, index) => {
    if (node.nodeType === 1 && node.hasAttribute('wx:if')) {
      branch = !!evaluate(node.getAttribute('wx:if'), context);
      if (!branch) return;
    } else if (node.nodeType === 1 && node.hasAttribute('wx:else')) {
      if (branch) return;
    }
    renderNode(node, parent, context, owner, `${path}-${index}`);
  });
}
function renderNode(node, parent, context, owner, path, skipFor = false) {
  if (node.nodeType === 3) {
    parent.append(document.createTextNode(evaluate(node.textContent, context)));
    return;
  }
  if (node.nodeType !== 1) return;
  if (!skipFor && node.hasAttribute('wx:for')) {
    const values = evaluate(node.getAttribute('wx:for'), context) || [];
    values.forEach((item, index) =>
      renderNode(
        node,
        parent,
        {
          ...context,
          [node.getAttribute('wx:for-item') || 'item']: item,
          [node.getAttribute('wx:for-index') || 'index']: index,
        },
        owner,
        `${path}-${index}`,
        true,
      ),
    );
    return;
  }
  const tag = node.tagName;
  const attributes = {};
  for (const attr of node.attributes)
    if (!attr.name.startsWith('wx:'))
      attributes[attr.name] = evaluate(attr.value, context);
  const events = {};
  const dataset = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('bind')) events[key.replace(/^bind:?/, '')] = value;
    if (key.startsWith('data-')) dataset[key.slice(5)] = value;
  }
  const call = (name, detail = {}) => {
    const method = events[name];
    if (method && owner[method])
      return owner[method]({ currentTarget: { dataset }, detail });
  };
  if (definitions[tag]) {
    const host = document.createElement(tag);
    parent.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const definition = definitions[tag];
    const props = {};
    for (const [key, desc] of Object.entries(definition.properties || {}))
      props[key] = attributes[key] ?? (desc === String ? '' : desc.value);
    const component = instance(
      definition,
      { ...definition.data, ...props },
      () => {
        if (host.isConnected) renderComponent();
      },
    );
    component.triggerEvent = (name) => call(name);
    const renderComponent = () => {
      shadow.innerHTML = `<style>:host {display:block} * {box-sizing:border-box} button {font:inherit;cursor:pointer} ${spec.components[tag].css}</style>`;
      renderChildren(
        parse(spec.components[tag].template).childNodes,
        shadow,
        component.data,
        component,
        path,
      );
    };
    host.__component = component;
    renderComponent();
    for (const [name, observer] of Object.entries(definition.observers || {}))
      if (!name.includes(',')) observer.call(component, component.data[name]);
    return;
  }
  const element = document.createElement(
    {
      view: 'div',
      text: 'span',
      navigator: 'a',
      image: 'img',
      block: 'div',
      'checkbox-group': 'div',
      checkbox: 'input',
      switch: 'input',
    }[tag] || tag,
  );
  if (tag === 'block') element.classList.add('wx-block');
  if (tag === 'text') element.classList.add('wx-text');
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('bind') || key.startsWith('data-')) continue;
    if (['disabled', 'checked'].includes(key)) element[key] = !!value;
    else if (key === 'value') element.value = value;
    else if (key === 'url') element.href = '#' + value.split('/')[2];
    else if (
      key === 'src' ||
      key === 'class' ||
      key === 'id' ||
      key === 'for' ||
      key === 'placeholder' ||
      key === 'maxlength' ||
      key.startsWith('aria-') ||
      key === 'role'
    )
      element.setAttribute(key, value);
  }
  element.dataset.path = path;
  if (tag === 'checkbox' || tag === 'switch') {
    element.type = 'checkbox';
    element.style.width = '24px';
    element.style.height = '24px';
    element.style.flexShrink = '0';
  }
  if (tag === 'image') {
    element.style.objectFit = 'contain';
    element.addEventListener('load', () => call('load'));
    element.addEventListener('error', () => call('error'));
  }
  element.addEventListener('click', (event) => {
    if (events.tap) {
      event.stopPropagation();
      call('tap');
    }
  });
  if (events.input)
    element.addEventListener('input', () =>
      call('input', { value: element.value }),
    );
  if (events.change)
    element.addEventListener('change', () =>
      call('change', {
        value:
          tag === 'switch'
            ? element.checked
            : [...element.querySelectorAll('input:checked')].map(
                (input) => input.value,
              ),
      }),
    );
  renderChildren(node.childNodes, element, context, owner, path);
  parent.append(element);
}
function renderPage() {
  if (!spec || !currentPage) return;
  const active = document.activeElement;
  const path = active?.dataset?.path;
  const selection = active?.selectionStart;
  const root = document.querySelector('#app');
  root.replaceChildren();
  renderChildren(
    parse(spec.template).childNodes,
    root,
    currentPage.data,
    currentPage,
    'page',
  );
  if (path) {
    const replacement = document.querySelector(`[data-path="${path}"]`);
    replacement?.focus({ preventScroll: true });
    if (typeof selection === 'number')
      replacement?.setSelectionRange?.(selection, selection);
  }
}
async function script(url) {
  const source = await (await fetch(url)).text();
  Function(source)();
}
async function navigate() {
  const name = location.hash.slice(1) || 'home';
  spec = await (await fetch('/spec?page=' + name)).json();
  document.querySelector('#app-css').textContent = spec.appCss;
  document.querySelector('#page-css').textContent = spec.css;
  for (const comp of Object.keys(spec.components))
    if (!definitions[comp]) {
      registerName = comp;
      await script('/bundle?kind=components&name=' + comp);
    }
  await script('/bundle?kind=pages&name=' + name);
  renderPage();
  currentPage.onLoad?.();
  currentPage.onShow?.();
  window.scrollTo(0, 0);
  document.body.dataset.ready = name;
}
window.addEventListener('hashchange', () => {
  void navigate();
});
void navigate();
