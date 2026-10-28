"use strict";

const BMD = (() => {
  const MARKED_OPTS = { gfm: true, breaks: false, headerIds: false, mangle: false };

  function configure() {
    if (typeof marked === "undefined") return;
    marked.setOptions(MARKED_OPTS);
  }

  function asResult(input) {
    if (input && typeof input === "object" && "text" in input) return input;
    return { text: input || "", missing: !input };
  }

  const PURIFY_OPTS = {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["form", "input", "button", "select", "textarea", "style", "iframe", "object", "embed", "base", "meta", "link"],
    FORBID_ATTR: ["formaction", "form", "target", "srcdoc"],
    ALLOW_DATA_ATTR: false,
  };

  function renderMarkdown(text) {
    configure();
    const html = marked.parse(text || "", MARKED_OPTS);
    return DOMPurify.sanitize(html, PURIFY_OPTS);
  }

  function buildLineDiff(oldText, newText) {
    return Diff.diffLines(oldText || "", newText || "", { newlineIsToken: false });
  }

  function makeRenderedDoc(input, extraClass = "", emptyMsg = null) {
    const res = asResult(input);
    const wrap = document.createElement("div");
    wrap.className = `bmd-rendered ${extraClass}`.trim();
    if (!res.text || !res.text.trim()) {
      const note = document.createElement("div");
      note.className = "bmd-empty-note";
      note.textContent = emptyMsg || (res.missing ? "(file does not exist in this revision)" : "(empty file)");
      wrap.appendChild(note);
      return wrap;
    }
    wrap.innerHTML = renderMarkdown(res.text);
    if (res.url) {
      for (const img of wrap.querySelectorAll("img[src]")) {
        const src = img.getAttribute("src");
        if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) continue;
        try { img.src = new URL(src, res.url).href; } catch {}
      }
    }
    return wrap;
  }

  function pairElements(left, right, key) {
    const pairs = [];
    const removed = [];
    const added = [];
    let oldIndex = 0;
    let newIndex = 0;
    const flush = () => {
      for (let i = 0; i < Math.max(removed.length, added.length); i++) {
        pairs.push([removed[i] || null, added[i] || null]);
      }
      removed.length = 0;
      added.length = 0;
    };
    const parts = Diff.diffArrays(left, right, { comparator: (a, b) => key(a) === key(b), timeout: 100 }) || [{ removed: true, count: left.length }, { added: true, count: right.length }];
    for (const part of parts) {
      if (part.removed) {
        removed.push(...left.slice(oldIndex, oldIndex + part.count));
        oldIndex += part.count;
      } else if (part.added) {
        added.push(...right.slice(newIndex, newIndex + part.count));
        newIndex += part.count;
      } else {
        flush();
        for (let i = 0; i < part.count; i++) pairs.push([left[oldIndex++], right[newIndex++]]);
      }
    }
    flush();
    return pairs;
  }

  function alignSideBySide(root, oldDoc, newDoc, left, right) {
    const text = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();
    const blockKey = (node) => node.nodeName + ":" + text(node.tagName === "TABLE" ? node.tHead || node.rows[0] : node);
    const children = (doc) => [...doc.childNodes].filter((node) => node.nodeType !== Node.TEXT_NODE || text(node));
    const blocks = [];
    const rows = [];
    for (const pair of pairElements(children(oldDoc), children(newDoc), blockKey)) {
      if (pair.every((node) => node?.tagName === "TABLE")) {
        const columns = pair.map((table) => [...table.rows].reduce((max, row) => Math.max(max, [...row.cells].reduce((n, cell) => n + cell.colSpan, 0)), 1));
        for (const tag of ["thead", "tbody", "tfoot"]) {
          const groups = pair.map((table) => table.querySelector(":scope > " + tag));
          if (!groups.some(Boolean)) continue;
          const rowKey = (row) => [...row.cells].map(text).find(Boolean) || "";
          const aligned = pairElements([...(groups[0]?.rows || [])], [...(groups[1]?.rows || [])], rowKey).map((rowPair) => rowPair.map((row, side) => {
            if (row) return row;
            const gap = document.createElement("tr");
            gap.className = "bmd-align-gap";
            gap.setAttribute("aria-hidden", "true");
            const cell = gap.insertCell();
            cell.colSpan = columns[side];
            return gap;
          }));
          groups.forEach((group, side) => {
            if (!group) group = pair[side].appendChild(document.createElement(tag));
            group.replaceChildren(...aligned.map((rowPair) => rowPair[side]));
          });
          rows.push(...aligned);
        }
      }
      blocks.push(pair.map((node) => {
        const wrap = document.createElement("div");
        wrap.className = "bmd-aligned-block";
        if (node) wrap.appendChild(node);
        else wrap.setAttribute("aria-hidden", "true");
        return wrap;
      }));
    }
    oldDoc.replaceChildren(...blocks.map((pair) => pair[0]));
    newDoc.replaceChildren(...blocks.map((pair) => pair[1]));
    let frame = 0;
    let scrollFrame = 0;
    let width = 0;
    let disposed = false;
    let syncing = false;
    let active = left;
    const sync = (source, target) => {
      if (disposed || syncing) return;
      syncing = true;
      active = source;
      const range = source.scrollWidth - source.clientWidth;
      target.scrollLeft = range > 0 ? source.scrollLeft / range * (target.scrollWidth - target.clientWidth) : 0;
      target.scrollTop = source.scrollTop;
      scrollFrame = requestAnimationFrame(() => { syncing = false; });
    };
    left.addEventListener("scroll", () => sync(left, right), { passive: true });
    right.addEventListener("scroll", () => sync(right, left), { passive: true });
    const reflow = () => {
      frame = 0;
      if (disposed || !root.isConnected || !root.clientWidth) return;
      for (const pair of blocks) for (const node of pair) node.style.minHeight = "";
      for (const pair of rows) for (const node of pair) node.style.height = "";
      const rowHeights = rows.map((pair) => Math.ceil(Math.max(...pair.map((node) => node.getBoundingClientRect().height))));
      rows.forEach((pair, i) => { for (const node of pair) node.style.height = rowHeights[i] + "px"; });
      const blockHeights = blocks.map((pair) => Math.ceil(Math.max(...pair.map((node) => node.getBoundingClientRect().height))));
      blocks.forEach((pair, i) => { for (const node of pair) node.style.minHeight = blockHeights[i] + "px"; });
      sync(active, active === left ? right : left);
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(reflow); };
    const observer = new ResizeObserver(() => {
      if (root.clientWidth !== width) {
        width = root.clientWidth;
        schedule();
      }
    });
    observer.observe(root);
    root.addEventListener("load", schedule, true);
    root.addEventListener("error", schedule, true);
    root.bmdDispose = () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      root.removeEventListener("load", schedule, true);
      root.removeEventListener("error", schedule, true);
    };
    schedule();
  }

  function makeSideBySide(oldInput, newInput) {
    const oldRes = asResult(oldInput);
    const newRes = asResult(newInput);
    const newFile = oldRes.missing && !newRes.missing;
    const deletedFile = newRes.missing && !oldRes.missing;

    const root = document.createElement("div");
    root.className = "bmd-sxs";

    const left = document.createElement("div");
    left.className = "bmd-sxs-col bmd-sxs-old";
    const leftHead = document.createElement("div");
    leftHead.className = "bmd-sxs-head";
    leftHead.textContent = "Before";
    left.appendChild(leftHead);
    const oldDoc = makeRenderedDoc(oldRes, "", newFile ? "(new file — did not exist before)" : null);
    const leftScroll = document.createElement("div");
    leftScroll.className = "bmd-sxs-scroll";
    leftScroll.tabIndex = 0;
    leftScroll.setAttribute("role", "region");
    leftScroll.setAttribute("aria-label", "Before preview");
    leftScroll.appendChild(oldDoc);
    left.appendChild(leftScroll);

    const right = document.createElement("div");
    right.className = "bmd-sxs-col bmd-sxs-new";
    const rightHead = document.createElement("div");
    rightHead.className = "bmd-sxs-head";
    rightHead.textContent = "After";
    right.appendChild(rightHead);
    const newDoc = makeRenderedDoc(newRes, "", deletedFile ? "(file deleted)" : null);
    const rightScroll = document.createElement("div");
    rightScroll.className = "bmd-sxs-scroll";
    rightScroll.tabIndex = 0;
    rightScroll.setAttribute("role", "region");
    rightScroll.setAttribute("aria-label", "After preview");
    rightScroll.appendChild(newDoc);
    right.appendChild(rightScroll);

    root.appendChild(left);
    root.appendChild(right);
    alignSideBySide(root, oldDoc, newDoc, leftScroll, rightScroll);
    return root;
  }

  function makeUnifiedRendered(oldInput, newInput) {
    const oldRes = asResult(oldInput);
    const newRes = asResult(newInput);
    const root = document.createElement("div");
    root.className = "bmd-unified";

    if (oldRes.missing && !newRes.missing) {
      const note = document.createElement("div");
      note.className = "bmd-empty-note bmd-empty-banner";
      note.textContent = "New file — entire content is added below";
      root.appendChild(note);
    } else if (newRes.missing && !oldRes.missing) {
      const note = document.createElement("div");
      note.className = "bmd-empty-note bmd-empty-banner";
      note.textContent = "File deleted — original content shown below struck through";
      root.appendChild(note);
    }

    const parts = buildLineDiff(oldRes.text, newRes.text);
    for (const part of parts) {
      if (!part.value) continue;
      const block = document.createElement("div");
      if (part.added) {
        block.className = "bmd-block bmd-added";
      } else if (part.removed) {
        block.className = "bmd-block bmd-removed";
      } else {
        block.className = "bmd-block bmd-context";
      }
      block.appendChild(makeRenderedDoc({ ...(part.removed ? oldRes : newRes), text: part.value }));
      root.appendChild(block);
    }
    return root;
  }

  return {
    renderMarkdown,
    makeRenderedDoc,
    makeSideBySide,
    makeUnifiedRendered,
  };
})();
