// KitUI — 全局轻交互工具（纯 DOM，跨所有屏复用）
// window.KitUI.toast(msg,tone) / confirm({...}) / modal({...}) / formModal({...})
// 通过隐藏 x-import 预加载注册；导出一个 no-op 组件 KitUIScreen 供 x-import 挂载。
(function () {
  if (window.KitUI) { window.KitUIScreen = window.KitUIScreen || function () { return null; }; return; }

  var Z = 3000;
  function el(tag, style, html) {
    var e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (html != null) e.innerHTML = html;
    return e;
  }

  // —— Toast ——
  function toastHost() {
    var h = document.getElementById("kitui-toasts");
    if (!h) {
      h = el("div", { position: "fixed", left: "50%", top: "78px", transform: "translateX(-50%)", zIndex: Z + 100, display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", pointerEvents: "none" });
      h.id = "kitui-toasts";
      document.body.appendChild(h);
    }
    return h;
  }
  function toast(msg, tone) {
    var bg = tone === "danger" ? "var(--danger)" : tone === "ok" ? "var(--ok)" : "var(--ink)";
    var t = el("div", {
      background: bg, color: "#fff", padding: "9px 18px", borderRadius: "999px",
      fontSize: "13px", fontWeight: "600", boxShadow: "var(--shadow-pop)",
      opacity: "0", transition: "opacity .18s, transform .18s", transform: "translateY(-6px)",
    }, msg);
    toastHost().appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = "1"; t.style.transform = "translateY(0)"; });
    setTimeout(function () { t.style.opacity = "0"; t.style.transform = "translateY(-6px)"; setTimeout(function () { t.remove(); }, 200); }, 1800);
  }

  // —— Overlay 基础 ——
  function overlay(onClose) {
    var ov = el("div", { position: "fixed", inset: "0", zIndex: Z, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: "24px" });
    ov.addEventListener("click", function (e) { if (e.target === ov) onClose(); });
    return ov;
  }
  function panel(width) {
    return el("div", { background: "var(--panel)", borderRadius: "12px", width: (width || 460) + "px", maxWidth: "94vw", maxHeight: "86vh", overflow: "auto", boxShadow: "var(--shadow-pop)" });
  }
  function header(box, title, subtitle, onClose) {
    var h = el("div", { padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: "12px" });
    var left = el("div");
    left.appendChild(el("div", { fontSize: "15px", fontWeight: "800" }, title));
    if (subtitle) left.appendChild(el("div", { fontSize: "12px", color: "var(--ink-soft)", marginTop: "2px" }, subtitle));
    var x = el("button", { marginLeft: "auto", border: "0", background: "transparent", cursor: "pointer", fontSize: "22px", lineHeight: "1", color: "var(--ink-soft)" }, "×");
    x.addEventListener("click", onClose);
    h.appendChild(left); h.appendChild(x);
    box.appendChild(h);
  }
  function btn(label, kind) {
    var s = { borderRadius: "8px", padding: "8px 16px", cursor: "pointer", fontSize: "13px", fontWeight: "700" };
    if (kind === "primary") Object.assign(s, { border: "0", background: "var(--brand)", color: "#fff" });
    else if (kind === "danger") Object.assign(s, { border: "0", background: "var(--danger)", color: "#fff" });
    else Object.assign(s, { border: "1px solid var(--line)", background: "var(--surface-2)", color: "var(--ink)", fontWeight: "600" });
    return el("button", s, label);
  }

  // —— Confirm ——
  function confirm(opts) {
    opts = opts || {};
    var close = function () { ov.remove(); };
    var ov = overlay(close);
    var box = panel(opts.width || 380);
    header(box, opts.title || "确认操作", null, close);
    box.appendChild(el("div", { padding: "18px 20px", fontSize: "13px", color: "var(--ink)", lineHeight: "1.7" }, opts.message || "确定执行该操作？"));
    var foot = el("div", { padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: "8px" });
    var cancel = btn(opts.cancelText || "取消");
    var ok = btn(opts.confirmText || "确定", opts.danger ? "danger" : "primary");
    cancel.addEventListener("click", close);
    ok.addEventListener("click", function () { close(); if (opts.onConfirm) opts.onConfirm(); });
    foot.appendChild(cancel); foot.appendChild(ok);
    box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
  }

  // —— Modal（自定义 body HTML + actions）——
  function modal(opts) {
    opts = opts || {};
    var close = function () { ov.remove(); };
    var ov = overlay(close);
    var box = panel(opts.width || 460);
    header(box, opts.title || "", opts.subtitle, close);
    var body = el("div", { padding: "18px 20px" }, opts.bodyHTML || "");
    box.appendChild(body);
    var foot = el("div", { padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: "8px" });
    (opts.actions || [{ label: "关闭" }]).forEach(function (a) {
      var b = btn(a.label, a.primary ? "primary" : a.danger ? "danger" : "");
      b.addEventListener("click", function () { close(); if (a.onClick) a.onClick(); });
      foot.appendChild(b);
    });
    box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
    return { close: close, body: body };
  }

  // —— FormModal（字段表单 → onSave(values) ）——
  function formModal(opts) {
    opts = opts || {};
    var close = function () { ov.remove(); };
    var ov = overlay(close);
    var box = panel(opts.width || 480);
    header(box, opts.title || "编辑", opts.subtitle, close);
    var body = el("div", { padding: "18px 20px", display: "grid", gridTemplateColumns: opts.cols === 2 ? "1fr 1fr" : "1fr", gap: "12px" });
    (opts.fields || []).forEach(function (f) {
      var wrap = el("div", f.full ? { gridColumn: "1 / -1" } : null);
      wrap.appendChild(el("div", { fontSize: "12px", fontWeight: "600", color: "var(--ink-soft)", marginBottom: "5px" }, f.label));
      var input;
      if (f.type === "select") {
        input = el("select", null);
        (f.options || []).forEach(function (o) { var op = el("option", null, o); op.value = o; if (o === f.value) op.selected = true; input.appendChild(op); });
      } else if (f.type === "textarea") {
        input = el("textarea", { minHeight: "64px", resize: "vertical" });
        input.value = f.value || "";
      } else {
        input = el("input", null);
        input.type = f.type || "text";
        input.value = f.value != null ? f.value : "";
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      Object.assign(input.style, { width: "100%", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "8px 11px", fontSize: "13px", background: "#fff", boxSizing: "border-box" });
      input.setAttribute("data-key", f.key);
      wrap.appendChild(input);
      body.appendChild(wrap);
    });
    box.appendChild(body);
    var foot = el("div", { padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: "8px" });
    var cancel = btn("取消");
    var save = btn(opts.saveText || "保存", "primary");
    cancel.addEventListener("click", close);
    save.addEventListener("click", function () {
      var vals = {};
      body.querySelectorAll("[data-key]").forEach(function (i) { vals[i.getAttribute("data-key")] = i.value; });
      close(); if (opts.onSave) opts.onSave(vals);
    });
    foot.appendChild(cancel); foot.appendChild(save);
    box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
  }

  // —— 水波粼粼动效（DESIGN-SYSTEM §7.3：导出完成反馈）——
  function ripple(anchorEl) {
    var r = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
    if (r && !r.width && !r.height) r = null; // anchor 已从文档移除 → 居中兜底
    var cx = r ? r.left + r.width / 2 : window.innerWidth / 2;
    var cy = r ? r.top + r.height / 2 : window.innerHeight / 2;
    var host = el("div", { position: "fixed", inset: "0", zIndex: Z + 200, pointerEvents: "none" });
    document.body.appendChild(host);
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      var ck = el("div", { position: "absolute", left: cx - 14 + "px", top: cy - 14 + "px", width: "28px", height: "28px", borderRadius: "50%", background: "var(--ok)", color: "#fff", display: "grid", placeItems: "center", fontSize: "16px", fontWeight: "800", opacity: "0", transition: "opacity .3s" }, "✓");
      host.appendChild(ck);
      requestAnimationFrame(function () { ck.style.opacity = "1"; });
      setTimeout(function () { host.remove(); }, 900);
      return;
    }
    // ① 水滴从上方落下（150ms ease-in，scaleY 拉伸）
    var drop = el("div", { position: "absolute", left: cx - 5 + "px", top: cy - 46 + "px", width: "10px", height: "14px", background: "var(--brand)", borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", transform: "scaleY(1.2)", transition: "top .15s ease-in, opacity .1s" });
    host.appendChild(drop);
    requestAnimationFrame(function () { drop.style.top = cy - 7 + "px"; });
    setTimeout(function () { drop.style.opacity = "0"; }, 150);
    // ② 触达后 3 圈同心水波，间隔 120ms，opacity 0.4→0（600ms）
    for (var i = 0; i < 3; i++) (function (i) {
      setTimeout(function () {
        var w = el("div", { position: "absolute", left: cx - 8 + "px", top: cy - 8 + "px", width: "16px", height: "16px", borderRadius: "50%", border: "2px solid var(--brand)", background: "var(--brand-soft)", opacity: "0.4", transform: "scale(0.5)", transition: "transform .6s ease-out, opacity .6s ease-out" });
        host.appendChild(w);
        requestAnimationFrame(function () { w.style.transform = "scale(" + (4 + i * 2.2) + ")"; w.style.opacity = "0"; w.style.background = "transparent"; });
      }, 150 + i * 120);
    })(i);
    setTimeout(function () { host.remove(); }, 1400);
  }

  // —— 撤回 toast（DATABASE §8 软删除：删除后可一键撤回）——
  function undoToast(msg, onUndo, ms) {
    var t = el("div", {
      background: "var(--ink)", color: "#fff", padding: "9px 12px 9px 18px", borderRadius: "999px",
      fontSize: "13px", fontWeight: "600", boxShadow: "var(--shadow-pop)", display: "flex", alignItems: "center", gap: "12px",
      opacity: "0", transition: "opacity .18s, transform .18s", transform: "translateY(-6px)", pointerEvents: "auto",
    }, "<span>" + msg + "</span>");
    var u = el("button", { border: "0", background: "rgba(255,255,255,0.16)", color: "#9CC4F0", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: "800", cursor: "pointer" }, "撤回");
    var done = false;
    u.addEventListener("click", function () {
      if (done) return; done = true;
      t.remove();
      if (onUndo) onUndo();
      toast("已撤回", "ok");
    });
    t.appendChild(u);
    toastHost().appendChild(t);
    requestAnimationFrame(function () { t.style.opacity = "1"; t.style.transform = "translateY(0)"; });
    setTimeout(function () { if (done) return; done = true; t.style.opacity = "0"; t.style.transform = "translateY(-6px)"; setTimeout(function () { t.remove(); }, 200); }, ms || 5000);
  }

  // —— 模拟文件夹选择器（全局导出规范：真实文件系统由 Vue 版接 showDirectoryPicker）——
  function folderPicker(onPick) {
    var close = function () { ov.remove(); };
    var ov = overlay(close);
    ov.style.zIndex = Z + 50;
    var box = panel(400);
    header(box, "选择文件夹", "选择导出文件的保存位置", close);
    var body = el("div", { padding: "10px 12px" });
    var TREE = [
      { path: "C:\\Users\\Admin\\Desktop", label: "桌面", depth: 0 },
      { path: "C:\\Users\\Admin\\Downloads", label: "下载", depth: 0 },
      { path: "D:\\瑞航资料", label: "瑞航资料 (D:)", depth: 0 },
      { path: "D:\\瑞航资料\\发票归档", label: "发票归档", depth: 1 },
      { path: "D:\\瑞航资料\\送货单", label: "送货单", depth: 1 },
      { path: "D:\\瑞航资料\\工资表", label: "工资表", depth: 1 },
      { path: "D:\\瑞航资料\\导出", label: "导出", depth: 1 },
    ];
    var picked = null;
    var rows = TREE.map(function (n) {
      var row = el("div", { display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", paddingLeft: 10 + n.depth * 22 + "px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" },
        "<span style='font-size:15px'>📁</span><span>" + n.label + "</span>");
      row.addEventListener("click", function () {
        picked = n.path;
        rows.forEach(function (r2) { r2.style.background = "transparent"; r2.style.fontWeight = "400"; });
        row.style.background = "var(--brand-soft)"; row.style.fontWeight = "700";
        ok.disabled = false; ok.style.opacity = "1";
      });
      body.appendChild(row);
      return row;
    });
    box.appendChild(body);
    var foot = el("div", { padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: "8px" });
    var cancel = btn("取消");
    var ok = btn("选择此文件夹", "primary");
    ok.disabled = true; ok.style.opacity = "0.5";
    cancel.addEventListener("click", close);
    ok.addEventListener("click", function () { if (!picked) return; close(); onPick(picked); });
    foot.appendChild(cancel); foot.appendChild(ok);
    box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
  }

  // —— 导出弹窗（全局通用规范：保存位置 + 文件夹结构两级 + 命名规则 + 预览 + 进度 + 水波）——
  // opts: { title, subtitle, count, unit, structureOptions:[..], nameOptions:[{label,sample}], ext, defaultName2, onDone }
  function exportModal(opts) {
    opts = opts || {};
    var structureOptions = opts.structureOptions || ["按采购方", "按票据类型", "按开票月份", "按项目"];
    var nameOptions = opts.nameOptions || [{ label: "发票号后8位", sample: "58760021" }, { label: "供应商简称", sample: "大板东建材" }, { label: "开票日期", sample: "2026-05-18" }, { label: "项目名称", sample: "车陂商业大楼" }];
    var ext = opts.ext || ".pdf";
    var count = opts.count != null ? opts.count : 12;
    var unit = opts.unit || "个文件";
    var close = function () { ov.remove(); };
    var ov = overlay(close);
    var box = panel(opts.width || 520);
    header(box, opts.title || "导出", opts.subtitle || "共 " + count + " " + unit + " · 配置保存方式", close);
    var body = el("div", { padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" });

    function row(label) {
      var w = el("div");
      w.appendChild(el("div", { fontSize: "12px", fontWeight: "600", color: "var(--ink-soft)", marginBottom: "5px" }, label));
      return w;
    }
    function sel(options, withNone) {
      var s = el("select", { width: "100%", border: "1px solid var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "8px 11px", fontSize: "13px", background: "#fff", boxSizing: "border-box" });
      (withNone ? ["（不分层）"].concat(options) : options).forEach(function (o) {
        var op = el("option", null, typeof o === "string" ? o : o.label); op.value = typeof o === "string" ? o : o.label; s.appendChild(op);
      });
      return s;
    }

    // 保存位置
    var wPath = row("保存位置");
    var pathBar = el("div", { display: "flex", gap: "8px" });
    var pathText = el("div", { flex: "1", border: "1px dashed var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "8px 11px", fontSize: "13px", color: "var(--ink-soft)", background: "var(--surface-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, "未选择 — 点击右侧选择文件夹");
    var pathBtn = btn("选择文件夹…");
    pathBtn.addEventListener("click", function () {
      folderPicker(function (p) { pathText.textContent = p; pathText.style.color = "var(--ink)"; pathText.style.borderStyle = "solid"; });
    });
    pathBar.appendChild(pathText); pathBar.appendChild(pathBtn);
    wPath.appendChild(pathBar);
    body.appendChild(wPath);

    // 文件夹结构（两级）
    var wStruct = row("文件夹结构");
    var structBar = el("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
    var lv1 = sel(structureOptions, false);
    var lv2 = sel(structureOptions, true);
    var c1 = el("div"); c1.appendChild(el("div", { fontSize: "11px", color: "var(--ink-soft)", marginBottom: "3px" }, "第一级")); c1.appendChild(lv1);
    var c2 = el("div"); c2.appendChild(el("div", { fontSize: "11px", color: "var(--ink-soft)", marginBottom: "3px" }, "第二级（可选）")); c2.appendChild(lv2);
    structBar.appendChild(c1); structBar.appendChild(c2);
    wStruct.appendChild(structBar);
    body.appendChild(wStruct);

    // 文件命名规则 + 预览
    var wName = row("文件命名规则");
    var nameBar = el("div", { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "8px", alignItems: "center" });
    var n1 = sel(nameOptions, false);
    var n2 = sel(nameOptions, false);
    if (nameOptions[1]) n2.value = nameOptions[1].label;
    nameBar.appendChild(n1);
    nameBar.appendChild(el("div", { fontSize: "13px", color: "var(--ink-soft)", fontWeight: "700" }, "+"));
    nameBar.appendChild(n2);
    wName.appendChild(nameBar);
    var preview = el("div", { marginTop: "6px", fontSize: "12px", color: "var(--ink-soft)" });
    function samp(v) { var f = null; nameOptions.forEach(function (o) { if (o.label === v) f = o; }); return f ? f.sample : v; }
    function updPreview() { preview.innerHTML = "预览: <b style='color:var(--ink)'>" + samp(n1.value) + "_" + samp(n2.value) + ext + "</b>"; }
    n1.addEventListener("change", updPreview); n2.addEventListener("change", updPreview); updPreview();
    wName.appendChild(preview);
    body.appendChild(wName);

    // 进度区（初始隐藏）
    var prog = el("div", { display: "none" });
    prog.appendChild(el("div", { fontSize: "12px", color: "var(--ink-soft)", marginBottom: "5px" }, "导出进度"));
    var bar = el("div", { height: "8px", borderRadius: "999px", background: "var(--surface-3)", overflow: "hidden" });
    var fill = el("div", { height: "100%", width: "0%", borderRadius: "999px", background: "var(--brand)", transition: "width .12s linear" });
    bar.appendChild(fill); prog.appendChild(bar);
    var progText = el("div", { fontSize: "12px", color: "var(--ink-soft)", marginTop: "5px" }, "");
    prog.appendChild(progText);
    body.appendChild(prog);

    box.appendChild(body);
    var foot = el("div", { padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: "8px" });
    var cancel = btn("取消");
    var go = btn(opts.goText || "开始导出", "primary");
    cancel.addEventListener("click", close);
    go.addEventListener("click", function () {
      if (pathText.textContent.indexOf("未选择") === 0) { toast("请先选择保存文件夹", "danger"); return; }
      go.disabled = true; go.style.opacity = "0.5"; cancel.disabled = true; cancel.style.opacity = "0.5";
      prog.style.display = "block";
      var done = 0;
      var timer = setInterval(function () {
        done += Math.max(1, Math.round(count / 14));
        if (done >= count) {
          done = count;
          clearInterval(timer);
          fill.style.width = "100%";
          progText.textContent = count + " / " + count + " · 完成";
          setTimeout(function () {
            close();
            ripple(opts.anchor);
            toast("已导出 " + count + " " + unit + " 至 " + pathText.textContent, "ok");
            if (opts.onDone) opts.onDone({ path: pathText.textContent, lv1: lv1.value, lv2: lv2.value, name: n1.value + "+" + n2.value });
          }, 320);
        } else {
          fill.style.width = Math.round(done / count * 100) + "%";
          progText.textContent = done + " / " + count + " · 正在写入 " + samp(n1.value) + "_" + samp(n2.value) + ext;
        }
      }, 110);
    });
    foot.appendChild(cancel); foot.appendChild(go);
    box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
  }

  // —— Excel 导入弹窗（选择文件 + 字段映射 + 预览行数 + 进度）——
  // opts: { title, subtitle, targetFields:[..], sourceCols:[..], fileName, rowCount, onDone(count) }
  function importModal(opts) {
    opts = opts || {};
    var targetFields = opts.targetFields || [];
    var sourceCols = opts.sourceCols || [];
    var rowCount = opts.rowCount != null ? opts.rowCount : 8;
    var close = function () { ov.remove(); };
    var ov = overlay(close);
    var box = panel(opts.width || 520);
    header(box, opts.title || "Excel 导入", opts.subtitle || "选择文件并核对字段映射", close);
    var body = el("div", { padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" });

    // 文件选择（模拟）
    var wFile = el("div");
    wFile.appendChild(el("div", { fontSize: "12px", fontWeight: "600", color: "var(--ink-soft)", marginBottom: "5px" }, "数据文件"));
    var fileBar = el("div", { display: "flex", gap: "8px" });
    var fileText = el("div", { flex: "1", border: "1px dashed var(--line-strong)", borderRadius: "var(--radius-btn)", padding: "8px 11px", fontSize: "13px", color: "var(--ink-soft)", background: "var(--surface-2)" }, "未选择 — 点击右侧选择 Excel");
    var fileBtn = btn("选择文件…");
    var picked = false;
    var mapWrap = el("div", { display: "none" });
    fileBtn.addEventListener("click", function () {
      picked = true;
      fileText.innerHTML = "📄 " + (opts.fileName || "导入数据.xlsx") + " <span style='color:var(--ink-soft)'>· 识别到 " + rowCount + " 行 · " + sourceCols.length + " 列</span>";
      fileText.style.color = "var(--ink)"; fileText.style.borderStyle = "solid";
      mapWrap.style.display = "block";
    });
    fileBar.appendChild(fileText); fileBar.appendChild(fileBtn);
    wFile.appendChild(fileBar);
    body.appendChild(wFile);

    // 字段映射表（源列 → 目标字段，自动匹配同名）
    mapWrap.appendChild(el("div", { fontSize: "12px", fontWeight: "600", color: "var(--ink-soft)", marginBottom: "5px" }, "字段映射（Excel 列 → 系统字段）"));
    var mapGrid = el("div", { display: "flex", flexDirection: "column", gap: "6px" });
    sourceCols.forEach(function (c) {
      var r = el("div", { display: "grid", gridTemplateColumns: "1fr 24px 1fr", alignItems: "center", gap: "6px" });
      r.appendChild(el("div", { fontSize: "13px", padding: "7px 10px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "8px" }, c));
      r.appendChild(el("div", { textAlign: "center", color: "var(--ink-soft)", fontSize: "12px" }, "→"));
      var s = el("select", { width: "100%", border: "1px solid var(--line-strong)", borderRadius: "8px", padding: "7px 10px", fontSize: "13px", background: "#fff", boxSizing: "border-box" });
      ["（忽略此列）"].concat(targetFields).forEach(function (f) { var op = el("option", null, f); if (f === c) op.selected = true; s.appendChild(op); });
      r.appendChild(s);
      mapGrid.appendChild(r);
    });
    mapWrap.appendChild(mapGrid);
    body.appendChild(mapWrap);
    box.appendChild(body);

    var foot = el("div", { padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: "8px" });
    var cancel = btn("取消");
    var go = btn("导入 " + rowCount + " 行", "primary");
    cancel.addEventListener("click", close);
    go.addEventListener("click", function () {
      if (!picked) { toast("请先选择 Excel 文件", "danger"); return; }
      close();
      toast("已导入 " + rowCount + " 行数据", "ok");
      if (opts.onDone) opts.onDone(rowCount);
    });
    foot.appendChild(cancel); foot.appendChild(go);
    box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
  }

  window.KitUI = { toast: toast, confirm: confirm, modal: modal, formModal: formModal, ripple: ripple, undoToast: undoToast, folderPicker: folderPicker, exportModal: exportModal, importModal: importModal };
  window.KitUIScreen = function () { return null; };
})();
