async (page) => {
  page.setDefaultTimeout(5000);
  const results = [];
  const requests = [];
  let releaseSlow;
  const slowResponse = new Promise((resolve) => { releaseSlow = resolve; });
  const extensionWorker = page.context().serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/src/background.js"));
  const installed = !!extensionWorker;
  const extensionName = installed ? await extensionWorker.evaluate(() => chrome.runtime.getManifest().name) : null;
  const origin = "https://bitbucket.org";
  const pr = "/bmd-fixture/docs/pull-requests/7";
  const files = {
    "docs/Alpha file.md": "# Alpha preview\n\nFirst document.\n",
    "docs/Beta file.md": "# Beta preview\n\nSecond document.\n",
    "docs/Slow file.md": "# Slow preview\n\nDelayed document.\n",
    "docs/Hash # and query?.md": "# Reserved path preview\n",
  };
  const check = (name, passed) => results.push({ name, passed });
  await page.route("**/*", async (route) => {
    const pathname = route.request().url().replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0];
    requests.push(pathname);
    if (pathname === `${pr}/diff`) {
      return route.fulfill({
        contentType: "text/html",
        body: `<main><div id="chg-docs/Alpha file.md"></div><article data-qa="branch-diff-file" aria-label="Diff of file docs/Alpha file.md"><div><header><span data-qa="bk-filepath">docs/Alpha file.md</span><label>Viewed<input type="checkbox"></label></header><section data-qa="bk-file__content" data-testid="native-diff"><div>Comments are hidden.</div><div>Line numbers</div><pre>@@ -0,0 +1,3 @@\n+# Alpha preview</pre></section></div></article></main>`,
      });
    }
    if (/\/pullrequests\/(7|8)$/.test(pathname)) {
      const next = pathname.endsWith("/8");
      return route.fulfill({
        json: {
          source: { commit: { hash: next ? "source-next" : "source" } },
          destination: { commit: { hash: next ? "destination-next" : "destination" } },
        },
      });
    }
    const raw = decodeURIComponent(pathname).match(/\/raw\/(source(?:-next)?|destination(?:-next)?)\/(.+)$/);
    if (raw) {
      if (raw[2] === "docs/Slow file.md") await slowResponse;
      if (raw[1] === "source-next") {
        return route.fulfill({ contentType: "text/plain", body: "# Next PR preview\n" });
      }
      if (raw[1] === "destination" && raw[2] === "docs/Deleted.md") {
        return route.fulfill({ contentType: "text/plain", body: "# Deleted preview\n" });
      }
      return route.fulfill(raw[1] === "source" && files[raw[2]]
        ? { contentType: "text/plain", body: files[raw[2]] }
        : { status: 404, body: "Not found" });
    }
    return route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto(origin + pr + "/diff");
  if (!installed) {
    await page.addStyleTag({ path: "src/styles.css" });
    for (const path of ["lib/marked.min.js", "lib/diff.min.js", "lib/purify.min.js", "src/renderer.js", "src/content.js"]) {
      await page.addScriptTag({ path });
    }
  }
  const card = page.locator("article");
  const nativeDiff = page.getByTestId("native-diff").locator("pre");
  const mode = (name) => card.getByRole("button", { name, exact: true });
  await mode("Rendered (side-by-side)").click();
  await card.locator(".bmd-loading").waitFor({ state: "detached" });
  check("added file renders its source revision", await card.getByRole("heading", { name: "Alpha preview" }).count() === 1);
  check("new file has an absent before revision", (await card.locator(".bmd-sxs-old").innerText()).includes("did not exist before"));
  check("side-by-side hides the original diff", !await nativeDiff.isVisible());
  await mode("Original diff").click();
  check("original mode restores the original diff", await nativeDiff.isVisible());
  await mode("Rendered (unified)").click();
  await card.locator(".bmd-loading").waitFor({ state: "detached" });
  check("unified hides the original diff", !await nativeDiff.isVisible());
  await card.evaluate((el) => {
    el.id = "chg-docs/Beta file.md";
    el.querySelector("[data-qa='bk-filepath']").textContent = "docs/Beta file.md";
    el.querySelector("pre").textContent = "@@ -0,0 +1,3 @@\n+# Beta preview";
  });
  await card.getByRole("heading", { name: "Beta preview" }).waitFor({ timeout: 2000 }).catch(() => {});
  check("reused file container fetches the new file path", requests.some((path) => path.endsWith("/source/docs/Beta%20file.md")));
  await mode("Rendered (side-by-side)").click();
  await card.locator(".bmd-loading").waitFor({ state: "detached" });
  check("switching files renders the newly selected file", await card.getByRole("heading", { name: "Beta preview" }).count() === 1);
  check("switching files removes the previous preview", await card.getByRole("heading", { name: "Alpha preview" }).count() === 0);
  check("one toolbar remains after file switching", await card.locator(".bmd-toolbar").count() === 1);
  await card.locator("[data-testid='native-diff']").evaluate((el) => {
    el.outerHTML = '<section data-qa="bk-file__content" data-testid="native-diff"><div>Line numbers</div><pre>@@ -0,0 +1,3 @@\n+# Beta preview</pre></section>';
  });
  await card.getByRole("heading", { name: "Beta preview" }).waitFor();
  check("replacing the native diff restores the selected preview", await card.locator(".bmd-btn.bmd-active").innerText() === "Rendered (side-by-side)");
  check("replacement raw content stays hidden", !await nativeDiff.isVisible());
  await card.locator("[data-testid='native-diff']").evaluate((el) => {
    el.innerHTML = '<div>Line numbers</div><pre>@@ -0,0 +1,3 @@\n+# Beta preview</pre>';
  });
  await card.getByRole("heading", { name: "Beta preview" }).waitFor({ timeout: 2000 }).catch(() => {});
  check("replacing only diff children restores the preview", await card.getByRole("heading", { name: "Beta preview" }).count() === 1);
  await card.locator(".bmd-toolbar").evaluate((el) => el.remove());
  await card.locator(".bmd-toolbar").waitFor({ timeout: 2000 }).catch(() => {});
  check("a removed toolbar is restored without duplicating it", await card.locator(".bmd-toolbar").count() === 1);
  if (!await card.locator(".bmd-toolbar").count()) throw new Error(JSON.stringify({ results, requests }, null, 2));
  await mode("Original diff").click();
  check("original mode works after file switching", await nativeDiff.isVisible());
  await card.evaluate((el) => {
    el.id = "chg-docs/Slow file.md";
    el.querySelector("[data-qa='bk-filepath']").textContent = "docs/Slow file.md";
    el.querySelector("pre").textContent = "@@ -0,0 +1,3 @@\n+# Slow preview";
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const slowRequest = page.waitForRequest((request) => request.url().includes("/raw/source/docs/Slow%20file.md"));
  await mode("Rendered (unified)").click();
  await slowRequest;
  await card.evaluate((el) => {
    el.id = "chg-docs/Alpha file.md";
    el.querySelector("[data-qa='bk-filepath']").textContent = "docs/Alpha file.md";
    el.querySelector("pre").textContent = "@@ -0,0 +1,3 @@\n+# Alpha preview";
  });
  await card.getByRole("heading", { name: "Alpha preview" }).waitFor();
  const slowFinished = page.waitForResponse((response) => response.url().includes("/raw/source/docs/Slow%20file.md"));
  releaseSlow();
  await slowFinished;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  check("a late response cannot replace the newly selected file", await card.getByRole("heading", { name: "Alpha preview" }).count() === 1 && await card.getByRole("heading", { name: "Slow preview" }).count() === 0);
  check("rendered mode survives rapid file switching", await card.locator(".bmd-btn.bmd-active").innerText() === "Rendered (unified)");
  await card.evaluate((el) => {
    el.id = "chg-docs/Hash # and query?.md";
    el.querySelector("[data-qa='bk-filepath']").textContent = "docs/Hash # and query?.md";
    el.querySelector("pre").textContent = "@@ -0,0 +1 @@\n+# Reserved path preview";
  });
  await card.getByRole("heading", { name: "Reserved path preview" }).waitFor();
  check("reserved filename characters remain in the requested path", requests.some((path) => path.endsWith("/source/docs/Hash%20%23%20and%20query%3F.md")));
  await card.evaluate((el) => {
    el.id = "chg-docs/Unavailable.md";
    el.querySelector("[data-qa='bk-filepath']").textContent = "docs/Unavailable.md";
    el.querySelector("pre").textContent = "@@ -0,0 +1 @@\n+# Unavailable preview";
  });
  await card.locator(".bmd-error").waitFor();
  check("two missing revisions show a fetch error", (await card.locator(".bmd-error").innerText()).includes("404 for both revisions"));
  files["docs/Unavailable.md"] = "# Recovered preview\n";
  await mode("Rendered (unified)").click();
  await card.locator(".bmd-loading").waitFor({ state: "detached" });
  check("a failed preview can be retried", await card.getByRole("heading", { name: "Recovered preview" }).count() === 1);
  await card.evaluate((el) => {
    el.id = "chg-docs/Deleted.md";
    el.querySelector("[data-qa='bk-filepath']").textContent = "docs/Deleted.md";
    el.querySelector("pre").textContent = "@@ -1,3 +0,0 @@\n-# Deleted preview";
  });
  await card.getByRole("heading", { name: "Deleted preview" }).waitFor();
  check("deleted files still render their original content", (await card.locator(".bmd-empty-banner").innerText()).includes("File deleted"));
  await page.evaluate(() => {
    history.pushState({}, "", "/bmd-fixture/docs/pull-requests/8/diff");
    document.querySelector("article pre").textContent = "@@ -0,0 +1 @@\n+# Next PR preview";
  });
  await card.getByRole("heading", { name: "Next PR preview" }).waitFor();
  check("switching PRs reloads metadata for an unchanged file path", requests.some((path) => path.endsWith("/pullrequests/8")));
  check("switching PRs clears the previous preview and revisions", await card.getByRole("heading", { name: "Deleted preview" }).count() === 0 && requests.some((path) => path.endsWith("/source-next/docs/Deleted.md")));
  const failures = results.filter((result) => !result.passed);
  if (failures.length) throw new Error(JSON.stringify({ results, requests }, null, 2));
  return { installedExtension: installed, extensionName, results, requests };
}
