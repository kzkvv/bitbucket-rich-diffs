async (page) => {
  page.setDefaultTimeout(5000);
  const requests = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (/\/raw\/(old|new)\/assets\/asset\.svg$/.test(url)) {
      await page.waitForTimeout(100);
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="green"/></svg>' });
    }
    if (url.endsWith("/pull-requests/7/diff")) {
      return route.fulfill({ contentType: "text/html", body: '<main style="width:720px;max-width:100%"></main>' });
    }
    return route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto("https://bitbucket.org/bmd-fixture/repo/pull-requests/7/diff");
  await page.addStyleTag({ path: "src/styles.css" });
  await page.addStyleTag({ content: ".bmd-rendered th,.bmd-rendered td{min-width:180px}" });
  for (const path of ["lib/marked.min.js", "lib/diff.min.js", "lib/purify.min.js", "src/renderer.js"]) {
    await page.addScriptTag({ path });
  }
  await page.evaluate(() => {
    const rows = Array.from({ length: 20 }, (_, i) => `| Stable ${i} | Same | Same | Same | Same |`).join("\n");
    const heading = "## Shared table\n\n| Name | A | B | C | D |\n|---|---|---|---|---|\n";
    const tail = "\n\n## Shared end\n\nStable footer.\n\n![Asset](../assets/asset.svg)";
    const oldText = "# Title\n\nOld intro.\n\n" + heading + "| Changed | Old | Value | Value | Value |\n" + rows + tail;
    const newText = "# Title\n\nNew intro.\n\nAn inserted paragraph above the table.\n\n![Inserted asset](../assets/asset.svg)\n\n" + heading + "| Added | New | Value | Value | Value |\n| Changed | New<br>several<br>extra<br>lines | Value | Value | Value |\n" + rows + tail;
    const oldRes = { text: oldText, url: "https://bitbucket.org/bmd-fixture/repo/raw/old/docs/page.md", missing: false };
    const newRes = { text: newText, url: "https://bitbucket.org/bmd-fixture/repo/raw/new/docs/page.md", missing: false };
    document.querySelector("main").appendChild(BMD.makeSideBySide(oldRes, newRes));
    const unified = BMD.makeUnifiedRendered({ ...oldRes, text: "![Old asset](../assets/asset.svg)\n" }, { ...newRes, text: "![New asset](../assets/asset.svg)\n" });
    document.querySelector("main").appendChild(unified);
    const raw = BMD.makeSideBySide("<div>HTML block</div>literal tail\n", "<div>HTML block</div>literal tail\n");
    raw.id = "raw-html";
    document.querySelector("main").appendChild(raw);
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".bmd-rendered img")].every((img) => img.complete));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const results = await page.evaluate(() => {
    const results = [];
    const check = (name, passed) => results.push({ name, passed });
    const root = document.querySelector(".bmd-sxs");
    const docs = [...root.querySelectorAll(".bmd-rendered")];
    const panes = [...root.querySelectorAll(".bmd-sxs-scroll")];
    check("both panes have horizontal scroll containers", panes.length === 2 && panes.every((p) => getComputedStyle(p).overflowX === "auto" && p.scrollWidth > p.clientWidth));
    check("wide tables stay inside the preview", root.scrollWidth <= root.clientWidth + 1);
    const findRow = (doc, text) => [...doc.querySelectorAll("tr")].find((row) => row.cells[0]?.textContent.trim() === text);
    for (const label of ["Stable 0", "Stable 19"]) {
      const left = findRow(docs[0], label);
      const right = findRow(docs[1], label);
      check(`${label} aligns despite inserted and changed rows`, Math.abs(left.getBoundingClientRect().top - right.getBoundingClientRect().top) <= 1);
    }
    const ends = docs.map((doc) => [...doc.querySelectorAll("h2")].find((h) => h.textContent === "Shared end"));
    check("content after the table remains aligned", Math.abs(ends[0].getBoundingClientRect().top - ends[1].getBoundingClientRect().top) <= 1);
    const headings = docs.map((doc) => [...doc.querySelectorAll("h2")].find((h) => h.textContent === "Shared table"));
    check("alignment updates after an inserted image loads", Math.abs(headings[0].getBoundingClientRect().top - headings[1].getBoundingClientRect().top) <= 1);
    const images = docs.map((doc) => doc.querySelector("img"));
    check("relative images use their own revision", images[0].src === "https://bitbucket.org/bmd-fixture/repo/raw/old/assets/asset.svg" && images[1].src === "https://bitbucket.org/bmd-fixture/repo/raw/new/assets/asset.svg");
    check("repository images load in both panes", images.every((img) => img.naturalWidth === 160));
    const unifiedImages = [...document.querySelectorAll(".bmd-unified img")];
    check("unified removed and added images retain revision context", unifiedImages.length === 2 && unifiedImages[0].src.includes("/raw/old/") && unifiedImages[1].src.includes("/raw/new/"));
    check("raw HTML text outside elements is preserved", [...document.querySelectorAll("#raw-html .bmd-rendered")].every((doc) => doc.innerText.includes("literal tail")));
    return results;
  });
  const panes = page.locator(".bmd-sxs").first().locator(".bmd-sxs-scroll");
  if (await panes.count() === 2) {
    await panes.nth(0).evaluate((p) => { p.scrollLeft = (p.scrollWidth - p.clientWidth) * 0.4; p.scrollTop = 140; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.push(...await page.evaluate(() => {
      const [l, r] = document.querySelectorAll(".bmd-sxs-scroll");
      const ratio = (p) => p.scrollLeft / (p.scrollWidth - p.clientWidth);
      return [{ name: "left horizontal scrolling updates the right pane", passed: l.scrollLeft > 0 && Math.abs(ratio(l) - ratio(r)) < 0.01 }, { name: "vertical scrolling stays synchronized", passed: l.scrollTop > 0 && Math.abs(l.scrollTop - r.scrollTop) <= 1 }];
    }));
    await panes.nth(1).evaluate((p) => { p.scrollLeft = (p.scrollWidth - p.clientWidth) * 0.75; p.scrollTop = 60; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.push(...await page.evaluate(() => {
      const [l, r] = document.querySelectorAll(".bmd-sxs-scroll");
      const ratio = (p) => p.scrollLeft / (p.scrollWidth - p.clientWidth);
      return [{ name: "right horizontal scrolling updates the left pane", passed: r.scrollLeft > 0 && Math.abs(ratio(l) - ratio(r)) < 0.01 }, { name: "right vertical scrolling updates the left pane", passed: r.scrollTop > 0 && Math.abs(l.scrollTop - r.scrollTop) <= 1 }];
    }));
  } else {
    results.push({ name: "bidirectional scroll synchronization", passed: false });
  }
  await page.locator("main").evaluate((el) => { el.style.width = "540px"; });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  results.push(await page.evaluate(() => {
    const docs = [...document.querySelectorAll(".bmd-sxs:first-child .bmd-rendered")];
    const rows = docs.map((doc) => [...doc.querySelectorAll("tr")].find((row) => row.cells[0]?.textContent.trim() === "Stable 19"));
    return { name: "matching rows remain aligned after resizing", passed: Math.abs(rows[0].getBoundingClientRect().top - rows[1].getBoundingClientRect().top) <= 1 };
  }));
  const beforeDispose = await page.evaluate(() => {
    const root = document.querySelector(".bmd-sxs");
    const [l, r] = root.querySelectorAll(".bmd-sxs-scroll");
    const position = { top: r.scrollTop, left: r.scrollLeft };
    root.bmdDispose?.();
    l.scrollTop = 0;
    l.scrollLeft = 0;
    return position;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  results.push(await page.evaluate((position) => {
    const r = document.querySelectorAll(".bmd-sxs-scroll")[1];
    return { name: "disposing the preview stops scroll synchronization", passed: !!r && r.scrollTop === position.top && r.scrollLeft === position.left };
  }, beforeDispose));
  if (results.some((r) => !r.passed)) throw new Error(JSON.stringify({ results, requests }, null, 2));
  return { results, requests };
}
