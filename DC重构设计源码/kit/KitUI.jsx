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
    var bg = tone === "danger" ? "var(--danger)" : tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn, #B45309)" : "var(--ink)";
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
    var returnFocus = document.activeElement;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.tabIndex = -1;
    var remove = ov.remove.bind(ov);
    ov.remove = function () { remove(); if (returnFocus && returnFocus.isConnected) returnFocus.focus(); };
    ov.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      var focusable = Array.from(ov.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']")).filter(function (node) { return node.getClientRects().length; });
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) { e.preventDefault(); ov.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    requestAnimationFrame(function () { if (ov.isConnected) { var first = ov.querySelector("button:not(:disabled), input:not(:disabled), select:not(:disabled)"); (first || ov).focus(); } });
    ov.addEventListener("click", function (e) { if (e.target === ov) onClose(); });
    return ov;
  }
  function panel(width) {
    return el("div", { background: "var(--panel)", borderRadius: "var(--radius-card)", width: (width || 460) + "px", maxWidth: "calc(100vw - 48px)", maxHeight: "86dvh", overflow: "auto", boxShadow: "var(--shadow-pop)" });
  }
  function header(box, title, subtitle, onClose) {
    var h = el("div", { padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: "12px" });
    var left = el("div");
    left.appendChild(el("div", { fontSize: "15px", fontWeight: "800" }, title));
    if (subtitle) left.appendChild(el("div", { fontSize: "12px", color: "var(--ink-soft)", marginTop: "2px" }, subtitle));
    var x = el("button", { marginLeft: "auto", border: "0", background: "transparent", cursor: "pointer", fontSize: "22px", lineHeight: "1", color: "var(--ink-soft)" }, "×");
    x.setAttribute("aria-label", "关闭弹窗");
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
    var close = function () { ov.remove(); if (opts.onCancel) { var f = opts.onCancel; opts.onCancel = null; f(); } };
    var ov = overlay(close);
    var box = panel(opts.width || 380);
    ov.setAttribute("aria-label", opts.title || "确认操作");
    header(box, opts.title || "确认操作", null, close);
    box.appendChild(el("div", { padding: "18px 20px", fontSize: "13px", color: "var(--ink)", lineHeight: "1.7" }, opts.message || "确定执行该操作？"));
    var foot = el("div", { padding: "0 20px 18px", display: "flex", justifyContent: "flex-end", gap: "8px" });
    var cancel = btn(opts.cancelText || "取消");
    var ok = btn(opts.confirmText || "确定", opts.danger ? "danger" : "primary");
    cancel.addEventListener("click", close);
    ok.addEventListener("click", function () { opts.onCancel = null; ov.remove(); if (opts.onConfirm) opts.onConfirm(); });
    foot.appendChild(cancel); foot.appendChild(ok);
    box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
    requestAnimationFrame(function () { if (cancel.isConnected) cancel.focus(); });
  }

  // —— Modal（自定义 body HTML + actions）——
  function modal(opts) {
    opts = opts || {};
    var close = function () { ov.remove(); };
    var ov = overlay(close);
    var box = panel(opts.width || 460);
    ov.setAttribute("aria-label", opts.title || "操作弹窗");
    header(box, opts.title || "操作弹窗", opts.subtitle, close);
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

  // —— buildFormBody：表单字段渲染核心（弹窗 formModal 与整页 KitFormPage 共用，grill 决议 2026-07-18 #3）——
  // 红圈对标（差距清单 2026-07-11 §1）字段契约 f：
  //     { section:"分组标题" }                      分组：grid 布局=整行小标题分隔；cards 布局=开一张新圆角卡片（锚点）
  //     { key,label,value,type,options,placeholder,full,
  //       required:true,                            必填：label 星号 + 保存全量校验（红框 + 字段下红字 + warning toast 双通道）
  //       hint:"说明",                               字段下方灰色说明文字
  //       suffix:"元",                               输入框尾单位；单位为「元」或 capital:true 时悬停 / 聚焦显示人民币大写
  //       auto:(vals)=>值, resetOn:["key"],          自动计算但可手动改写（如税额、无税金额）；用户改写后不再覆盖，
  //                                                  resetOn 中任一字段变化即恢复自动计算；返回 null 表示不自动
  //       check:(value, vals)=>"错误说明"|null,      输入时与保存时校验（如不能为负、不能超过含税金额、日期范围）
  //       unique:(value, vals)=>"重复说明"|null,     保存校验时查重（如合同编号），返回说明即判为错误
  //       min / max: "YYYY-MM-DD" | (vals)=>…         日期范围：日历置灰越界日期，保存时拦截
  //       type:"readonly",                          只读带出（灰底）；配 compute(vals) 任意字段变更实时重算（级联带出）
  //       type:"lookup",                            检索下拉：输入过滤 + 命中高亮 + ✕清空；options 可为 fn(vals)（级联过滤）
  //       dependsOn:{key,label},                    依赖字段未填：聚焦弹 warning toast「该字段依赖…」不开浮层
  //       type:"file", max:15,                      附件位 mock：虚线框「拖拽或点击上传（0/15）」，点击模拟添加，值=文件名数组
  //       type:"grid", columns:[{key,label,width,type:'text'|'number'|'select'|'readonly',options,derive(row)}],
  //         rows:[...], summaryKeys:["amount"], minRows:2 }
  //                                                 明细网格：添加/复制/删除 + EXCEL 粘贴(TSV) + 全屏编辑 + 派生列 + Σ汇总；保存返回行数组
  //   opts：{ fields, cols, layout:"grid"|"cards", onDirty() }
  //   返回 { node, getVals, getAllVals, validate, recompute, anchors:[{title,el}], focusFirst() }
  function buildFormBody(opts) {
    opts = opts || {};
    var ctrls = [];          // {f, get(), input, wrap, err} 按字段序
    var anchors = [];        // cards 布局的分区锚点（整页表单左侧导航用）
    var markDirty = function () { if (opts.onDirty) opts.onDirty(); };
    var getVals = function () {
      var vals = {};
      // readonly 带出字段默认不回写（显示值可能带千分位/「—」，写回会污染存储；要回写显式 saveValue:true）
      ctrls.forEach(function (c) { if (c.f.key && (c.f.type !== "readonly" || c.f.saveValue)) vals[c.f.key] = c.get(); });
      return vals;
    };
    var getAllVals = function () {   // 级联/带出计算用：包含 readonly 当前显示值
      var vals = {};
      ctrls.forEach(function (c) { if (c.f.key) vals[c.f.key] = c.get(); });
      return vals;
    };
    // 任意字段变更 → 重算 readonly compute 带出字段
    var recompute = function () {
      var vals = getAllVals();
      ctrls.forEach(function (c) {
        if (c.f.type === "readonly" && typeof c.f.compute === "function") {
          var v = c.f.compute(vals);
          c.input.textContent = v == null || v === "" ? "—" : String(v);
        }
        // 自动计算字段：resetOn 依赖变化则恢复自动；未手动改写时跟随其他字段
        if (c.f.auto && c.f.resetOn) {
          var sig = c.f.resetOn.map(function (k) { return vals[k]; }).join("|");
          if (c.depSig != null && c.depSig !== sig) c.manual = false;
          c.depSig = sig;
        }
        if (c.f.auto && !c.manual && c.setAuto) c.setAuto(c.f.auto(vals));
        if (c.f.check && c.liveCheck) c.liveCheck(vals);
        if (c.rangeOf) c.rerender && c.rerender();
        // 级联选项（options 为函数）随其他字段刷新
        if (c.rerender && typeof c.f.options === "function") c.rerender();
      });
    };
    var inputStyle = { width: "100%", height: "32px", border: "1px solid var(--line-strong)", borderRadius: "6px", padding: "0 10px", fontSize: "13px", background: "var(--panel)", boxSizing: "border-box", fontFamily: "inherit" };
    // 文本类控件统一套 KitControls 外框（kc-ctl：32px / 焦点环 / 错误红框 / 单位后缀分段）
    var ctlBox = function (inner, extraCls) {
      var box = el("label", null); box.className = "kc-ctl" + (extraCls ? " " + extraCls : "");
      box.appendChild(inner);
      return box;
    };

    // —— 检索下拉（KitLookup 设计稿版：过滤 + 高亮 + ✕ + 依赖拦截）——
    // —— 字段提示行：错误 > 自动计算状态 > 说明 ——
    function renderMsg(c) {
      var e = c.err;
      if (!e) return;
      e.innerHTML = "";
      e.removeAttribute("role");
      if (c.errorText) { e.style.color = "var(--danger-ink)"; e.textContent = c.errorText; e.title = c.errorText; e.setAttribute("role", "alert"); return; }
      e.style.color = "var(--ink-faint)";
      e.textContent = c.f.hint || "";
      e.title = c.f.hint || "";
    }
    // —— 金额大写：对应 reka-ui HoverCard（side="top"）；悬停 / 聚焦显示在输入框上方，可移入、选中复制或点复制按钮 ——
    function attachCapital(box, input) {
      var tip = null, timer = null;
      var keep = function () { clearTimeout(timer); };
      var hideSoon = function () { keep(); timer = setTimeout(hide, 200); };
      var hide = function () { if (tip) { tip.remove(); tip = null; } };
      var show = function () {
        keep();
        var KC = window.KitControls;
        var t = KC && KC.toCapital ? KC.toCapital(input.value) : "";
        if (!t) return hide();
        var r = box.getBoundingClientRect();
        if (!tip) {
          tip = el("div", null); tip.className = "kc-hint-pop"; tip.setAttribute("role", "tooltip");
          tip.addEventListener("mouseenter", keep); tip.addEventListener("mouseleave", hideSoon);
          var txt = el("span", null); txt.className = "kc-hint-text"; tip.appendChild(txt);
          var cp = el("button", null, "复制"); cp.className = "kc-hint-copy"; cp.type = "button"; cp.title = "复制"; cp.setAttribute("aria-label", "复制"); cp.style.fontSize = "11px"; cp.style.width = "auto"; cp.style.padding = "0 6px";
          cp.addEventListener("mousedown", function (e) { e.preventDefault(); });
          cp.addEventListener("click", function () { var v = tip.firstChild.textContent; var done = function () { cp.textContent = "已复制"; setTimeout(function () { if (cp) cp.textContent = "复制"; }, 1200); }; if (navigator.clipboard) navigator.clipboard.writeText(v).then(done, done); else done(); });
          tip.appendChild(cp);
          document.body.appendChild(tip);
        }
        tip.firstChild.textContent = t;
        // 同 reka-ui HoverCard side="top"：以 bottom 锚定在输入框上方，不测量浮层高度
        tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - 280)) + "px"; tip.style.bottom = (window.innerHeight - r.top + 6) + "px";
      };
      box.addEventListener("mouseenter", show); box.addEventListener("mouseleave", hideSoon);
      input.addEventListener("focus", show); input.addEventListener("blur", hideSoon); input.addEventListener("input", function () { if (tip) show(); });
    }
    // —— React 控件挂载：选择框 / 日期 / 检索复用 KitControls（与 reka-ui 同构），不在 DOM 里另写一套 ——
    // 返回 { node, input(=外框，供校验标红), get, setError }；值变化 → markDirty + recompute
    function mountKC(kind, f, extra) {
      var KC = window.KitControls;
      var host = el("div", { minWidth: "0" });
      var state = { value: f.value != null ? f.value : "", error: false };
      var root = ReactDOM.createRoot(host);
      var render = function () {
        var props = Object.assign({ value: state.value, error: state.error, placeholder: f.placeholder, ariaLabel: f.label,
          onChange: function (v) { state.value = v; render(); markDirty(); recompute(); } }, extra ? extra() : null);
        root.render(React.createElement(KC[kind], props));
      };
      render();
      return { node: host, input: host, rerender: render, get: function () { return state.value; },
        setError: function (on) { state.error = on; render(); } };
    }
    function buildLookup(f) {
      var getOptions = function () { return (typeof f.options === "function" ? f.options(getAllVals()) : f.options) || []; };
      var ctrl = mountKC("Combobox", f, function () { return { options: getOptions(), onCreate: f.onCreate, createLabel: f.createLabel }; });
      // 依赖字段未填：聚焦即提示并失焦，不开浮层（契约 dependsOn）
      ctrl.node.addEventListener("focusin", function (e) {
        if (!f.dependsOn || getAllVals()[f.dependsOn.key]) return;
        toast("该字段依赖「" + (f.dependsOn.label || f.dependsOn.key) + "」的值，请补全后操作", "warn");
        if (e.target && e.target.blur) e.target.blur();
      });
      return ctrl;
    }

    // —— 明细网格（KitEditGrid 设计稿版：添加/复制/删除 + 行内编辑 + 派生列 + Σ汇总）——
    function buildGrid(f) {
      var cols = f.columns || [];
      var rows = (f.value && Array.isArray(f.value) ? f.value : f.rows || []).map(function (r) { return Object.assign({}, r); });
      var minRows = f.minRows != null ? f.minRows : 2;
      while (rows.length < minRows) rows.push({});
      var wrap = el("div", { border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden" });
      var bar = el("div", { display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" });
      var mkTool = function (label, fn) {
        var b = el("button", { border: "1px solid var(--line)", background: "var(--panel)", borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: "600", cursor: "pointer", color: "var(--ink-soft)" }, label);
        b.type = "button"; b.addEventListener("click", fn); return b;
      };
      var selIdx = { v: -1 };
      bar.appendChild(el("span", { fontSize: "12px", fontWeight: "700", color: "var(--ink-soft)", marginRight: "auto" }, f.gridLabel || "明细行"));
      bar.appendChild(mkTool("＋ 添加行", function () { rows.push({}); renderBody(); markDirty(); }));
      bar.appendChild(mkTool("⧉ 复制选中", function () { if (selIdx.v < 0) return toast("先点选一行再复制", "warn"); rows.splice(selIdx.v + 1, 0, Object.assign({}, rows[selIdx.v])); renderBody(); markDirty(); }));
      bar.appendChild(mkTool("🗑 删除选中", function () { if (selIdx.v < 0) return toast("先点选一行再删除", "warn"); rows.splice(selIdx.v, 1); selIdx.v = -1; renderBody(); markDirty(); }));
      // EXCEL 粘贴：从 Excel 复制区域直接粘进来（TSV 按可编辑列顺序解析批量插行）——红圈「切换EXCEL模式」对标
      bar.appendChild(mkTool("⎘ EXCEL 粘贴", function () {
        var editCols = cols.filter(function (c) { return !c.derive && c.type !== "readonly"; });
        var m = modal({ title: "EXCEL 粘贴导入 · " + (f.gridLabel || "明细行"),
          subtitle: "在 Excel 中复制数据区域，粘贴到下方文本框；列顺序：" + editCols.map(function (c) { return c.label; }).join(" | "),
          width: 560, bodyHTML: "",
          actions: [{ label: "取消" }, { label: "解析并插入", primary: true, onClick: function () {
            var lines = ta.value.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
            if (!lines.length) return toast("未粘贴任何内容", "warn");
            lines.forEach(function (line) {
              var cells = line.split("\t");
              var row = {};
              editCols.forEach(function (c, i) {
                if (cells[i] == null || cells[i] === "") return;
                row[c.key] = c.type === "number" ? (Number(String(cells[i]).replace(/[^\d.\-]/g, "")) || "") : cells[i].trim();
              });
              rows.push(row);
            });
            renderBody(); markDirty();
            toast("已插入 " + lines.length + " 行", "ok");
          } }] });
        if (!m || !m.body) return;
        var ta = el("textarea", { width: "100%", minHeight: "160px", border: "1px solid var(--line-strong)", borderRadius: "8px", padding: "10px", fontSize: "12.5px", fontFamily: "var(--font-mono)", boxSizing: "border-box", resize: "vertical" });
        ta.placeholder = "粘贴示例（制表符分隔，每行一条）：\n墙面砖 800×800\t800×800\t㎡\t120\t45.5";
        m.body.appendChild(ta);
        setTimeout(function () { ta.focus(); }, 50);
      }));
      // 全屏编辑：网格节点整体搬进全屏浮层，改完原位放回（DOM 复用，编辑状态不丢）
      bar.appendChild(mkTool("⛶ 全屏编辑", function () {
        var ph = el("div");
        wrap.parentNode.insertBefore(ph, wrap);
        var fov = el("div", { position: "fixed", inset: "0", zIndex: String(Z + 120), background: "var(--bg, #F3F4F6)", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" });
        var bar2 = el("div", { display: "flex", alignItems: "center", gap: "12px" });
        bar2.appendChild(el("div", { fontSize: "15px", fontWeight: "800" }, (f.gridLabel || "明细行") + " · 全屏编辑"));
        bar2.appendChild(el("div", { fontSize: "12px", color: "var(--ink-soft)" }, "大批量录入模式，完成后返回表单"));
        var closeB = btn("完成，返回表单", "primary");
        closeB.style.marginLeft = "auto";
        bar2.appendChild(closeB);
        var host2 = el("div", { flex: "1", overflow: "auto" });
        host2.appendChild(wrap);
        fov.appendChild(bar2); fov.appendChild(host2);
        document.body.appendChild(fov);
        closeB.addEventListener("click", function () { ph.parentNode.replaceChild(wrap, ph); fov.remove(); });
      }));
      if (f.gridImport) bar.appendChild(mkTool("⤓ 导入明细", function () { (window.KitUI || {}).importModal && window.KitUI.importModal({ title: "导入" + (f.gridLabel || "明细行"), targetFields: cols.map(function (c) { return c.label; }), sourceCols: cols.map(function (c) { return c.label; }), fileName: "明细导入.xlsx", rowCount: 18, onDone: function (n) { toast("已导入 " + n + " 行明细（演示）", "ok"); } }); }));
      wrap.appendChild(bar);
      var scroller = el("div", { overflowX: "auto" });
      var tbl = el("table", { width: "100%", borderCollapse: "collapse", fontSize: "12.5px", minWidth: Math.max(420, cols.reduce(function (s, c) { return s + (c.width || 90); }, 30)) + "px" });
      var thead = el("thead");
      var hr = el("tr");
      hr.appendChild(el("th", { width: "26px", background: "var(--surface-2)", borderBottom: "1px solid var(--line)" }, ""));
      cols.forEach(function (c) {
        var th = el("th", { padding: "6px 8px", textAlign: c.type === "number" || c.derive ? "right" : "left", fontWeight: "700", color: "var(--ink-soft)", background: "var(--surface-2)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }, c.label + (c.required ? ' <span style="color:var(--danger)">*</span>' : ""));
        if (c.width) th.style.width = c.width + "px";
        hr.appendChild(th);
      });
      thead.appendChild(hr); tbl.appendChild(thead);
      var tbody = el("tbody");
      tbl.appendChild(tbody);
      var tfoot = el("tfoot");
      tbl.appendChild(tfoot);
      var cellInput = function (row, c) {
        var iv;
        if (c.derive || c.type === "readonly") {
          iv = el("div", { padding: "5px 4px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }, "");
          iv.setAttribute("data-derive", "1");
          return iv;
        }
        if (c.type === "select") {
          iv = el("select", { width: "100%", border: "1px solid transparent", background: "transparent", padding: "5px 2px", fontSize: "12.5px", borderRadius: "6px" });
          var blank = el("option", null, ""); blank.value = ""; iv.appendChild(blank);
          (c.options || []).forEach(function (o) { var op = el("option", null, o); op.value = o; if (o === row[c.key]) op.selected = true; iv.appendChild(op); });
        } else {
          iv = el("input", { width: "100%", border: "1px solid transparent", background: "transparent", padding: "5px 4px", fontSize: "12.5px", borderRadius: "6px", boxSizing: "border-box", textAlign: c.type === "number" ? "right" : "left", fontFamily: c.type === "number" ? "var(--font-mono)" : "inherit" });
          iv.type = c.type === "number" ? "number" : "text";
          iv.value = row[c.key] != null ? row[c.key] : "";
          if (c.placeholder) iv.placeholder = c.placeholder;
        }
        iv.addEventListener("focus", function () { iv.style.borderColor = "var(--brand)"; iv.style.background = "#fff"; });
        iv.addEventListener("blur", function () { iv.style.borderColor = "transparent"; iv.style.background = "transparent"; });
        iv.addEventListener(c.type === "select" ? "change" : "input", function () {
          row[c.key] = c.type === "number" ? (iv.value === "" ? "" : Number(iv.value)) : iv.value;
          markDirty(); refreshRowDerive(); refreshSum();
        });
        return iv;
      };
      var refreshRowDerive = function () {
        Array.prototype.forEach.call(tbody.children, function (tr, ri) {
          cols.forEach(function (c, ci) {
            if (!c.derive) return;
            var cell = tr.children[ci + 1].firstChild;
            var v = c.derive(rows[ri]);
            rows[ri][c.key] = v;
            cell.textContent = v == null || v === "" || isNaN(v) ? "—" : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
          });
        });
      };
      var refreshSum = function () {
        tfoot.innerHTML = "";
        if (!f.summaryKeys || !f.summaryKeys.length) return;
        var tr = el("tr");
        tr.appendChild(el("td", { background: "var(--surface-2)", borderTop: "1px solid var(--line)" }, ""));
        cols.forEach(function (c, ci) {
          var td = el("td", { padding: "6px 8px", textAlign: "right", fontWeight: "800", fontFamily: "var(--font-mono)", background: "var(--surface-2)", borderTop: "1px solid var(--line)" });
          if (f.summaryKeys.indexOf(c.key) > -1) {
            var s = rows.reduce(function (acc, r) { return acc + (Number(r[c.key]) || 0); }, 0);
            td.innerHTML = '<span style="color:var(--ink-faint);font-weight:600;margin-right:4px;">Σ</span>' + s.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
          } else if (ci === 0) { td.textContent = "合计"; td.style.textAlign = "left"; td.style.fontFamily = "inherit"; }
          tr.appendChild(td);
        });
        tfoot.appendChild(tr);
      };
      var renderBody = function () {
        tbody.innerHTML = "";
        rows.forEach(function (row, ri) {
          var tr = el("tr");
          tr.style.borderBottom = "1px solid var(--line)";
          var sel = el("td", { textAlign: "center", cursor: "pointer", color: "var(--ink-faint)", fontSize: "11px", background: selIdx.v === ri ? "var(--brand-soft)" : "transparent" }, String(ri + 1));
          sel.addEventListener("click", function () { selIdx.v = selIdx.v === ri ? -1 : ri; renderBody(); });
          tr.appendChild(sel);
          cols.forEach(function (c) {
            var td = el("td", { padding: "1px 4px", background: selIdx.v === ri ? "var(--brand-soft)" : "transparent" });
            td.appendChild(cellInput(row, c));
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        refreshRowDerive(); refreshSum();
      };
      renderBody();
      scroller.appendChild(tbl); wrap.appendChild(scroller);
      return { node: wrap, input: tbl, get: function () {
        return rows.filter(function (r) { return cols.some(function (c) { return r[c.key] !== "" && r[c.key] != null && !(c.derive); }); });
      } };
    }

    // —— 附件位（红圈式「拖拽或单击后粘贴 (0/15)」mock：点击模拟添加，值=文件名数组）——
    function buildFile(f) {
      var max = f.max || 9;
      var files = Array.isArray(f.value) ? f.value.slice() : [];
      var wrap = el("div");
      var box = el("div", { border: "1.5px dashed var(--line-strong)", borderRadius: "10px", padding: "12px 14px", textAlign: "center", cursor: "pointer", background: "var(--surface-2)", transition: "border-color .12s" });
      var label = el("div", { fontSize: "12px", color: "var(--ink-soft)" });
      var chips = el("div", { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: files.length ? "8px" : "0" });
      var paint = function () {
        label.innerHTML = "⇪ 拖拽文件到此处，或点击上传（" + files.length + "/" + max + "）";
        chips.innerHTML = "";
        chips.style.marginTop = files.length ? "8px" : "0";
        files.forEach(function (name, i) {
          var chip = el("span", { display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--brand-soft)", color: "var(--brand-deep, var(--brand))", borderRadius: "6px", padding: "2px 8px", fontSize: "11.5px", fontWeight: "600" }, "📄 " + name);
          var x = el("button", { border: "0", background: "transparent", cursor: "pointer", color: "inherit", padding: "0", fontSize: "12px", lineHeight: "1" }, "✕");
          x.addEventListener("click", function (e) { e.stopPropagation(); files.splice(i, 1); paint(); markDirty(); });
          chip.appendChild(x);
          chips.appendChild(chip);
        });
      };
      paint();
      box.appendChild(label);
      box.addEventListener("mouseenter", function () { box.style.borderColor = "var(--brand)"; });
      box.addEventListener("mouseleave", function () { box.style.borderColor = "var(--line-strong)"; });
      box.addEventListener("click", function () {
        if (files.length >= max) return toast("附件已达上限（" + max + " 个）", "warn");
        files.push((f.label || "附件") + "-" + (files.length + 1) + ".pdf");
        paint(); markDirty();
        toast("演示环境：已模拟添加 1 个附件（正式版接文件选择器）");
      });
      wrap.appendChild(box); wrap.appendChild(chips);
      return { node: wrap, input: box, get: function () { return files; } };
    }

    // —— 布局：grid（弹窗，默认）｜cards（整页表单：每个 section 一张圆角卡片 + 锚点）——
    // 两列 = repeat(auto-fit, minmax(280px,1fr))：容器不足最小可读宽度自动降单列（ADR 0013 响应式契约②③，勿写死 1fr 1fr）
    var cardsMode = opts.layout === "cards";
    var mkGrid = function () { return el("div", { display: "grid", gridTemplateColumns: opts.cols === 2 ? "repeat(auto-fit, minmax(280px, 1fr))" : "1fr", columnGap: "16px", rowGap: "6px", alignContent: "start" }); };
    var root, grid;
    if (cardsMode) { root = el("div"); grid = null; } else { root = grid = mkGrid(); }
    var openCard = function (title) {
      var card = el("div", { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-card, 14px)", padding: "16px 18px", marginBottom: "14px" });
      if (title) card.appendChild(el("div", { fontSize: "13.5px", fontWeight: "800", marginBottom: "12px", paddingBottom: "10px", borderBottom: "1px solid var(--line)" }, title));
      grid = mkGrid();
      card.appendChild(grid);
      root.appendChild(card);
      if (title) anchors.push({ title: title, el: card });
    };

    (opts.fields || []).forEach(function (f) {
      if (f.section) {
        if (cardsMode) { openCard(f.section); return; }
        var sec = el("div", { gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "10px", marginTop: ctrls.length ? "8px" : "0" });
        sec.appendChild(el("div", { fontSize: "12px", fontWeight: "800", color: "var(--brand-deep, var(--brand))", letterSpacing: "0.04em", whiteSpace: "nowrap" }, f.section));
        sec.appendChild(el("div", { flex: "1", height: "1px", background: "var(--line)" }, ""));
        grid.appendChild(sec);
        return;
      }
      if (cardsMode && !grid) openCard(null);
      var wrap = el("div", Object.assign({ display: "grid", gridTemplateRows: "20px auto 18px", rowGap: "4px", minWidth: "0" }, (f.full || f.type === "grid" || f.type === "textarea") ? { gridColumn: "1 / -1" } : null));
      var lab = el("div", { fontSize: "12px", fontWeight: "600", color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap", overflow: "hidden" });
      lab.innerHTML = f.label + (f.required ? ' <span style="color:var(--danger)">*</span>' : "");
      wrap.appendChild(lab);
      var ctrl;
      if (f.type === "lookup") {
        ctrl = buildLookup(f);
        wrap.appendChild(ctrl.node);
      } else if (f.type === "grid") {
        ctrl = buildGrid(f);
        wrap.appendChild(ctrl.node);
      } else if (f.type === "file") {
        ctrl = buildFile(f);
        wrap.appendChild(ctrl.node);
      } else if (f.type === "readonly") {
        var ro = el("span", { flex: "1", minWidth: "0", padding: "0 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, f.value == null || f.value === "" ? "—" : String(f.value));
        var roBox = ctlBox(ro, "ro");
        if (f.suffix) roBox.appendChild(el("span", null, f.suffix)).className = "kc-sfx";
        ctrl = { input: ro, box: roBox, get: function () { return ro.textContent === "—" ? "" : ro.textContent; } };
        wrap.appendChild(roBox);
      } else if (f.type === "select") {
        ctrl = mountKC("Select", f, function () { return { options: (typeof f.options === "function" ? f.options(getAllVals()) : f.options) || [] }; });
        wrap.appendChild(ctrl.node);
      } else if (f.type === "date") {
        var rangeOf = function () { var vals = getAllVals(); return { min: typeof f.min === "function" ? f.min(vals) : f.min, max: typeof f.max === "function" ? f.max(vals) : f.max }; };
        ctrl = mountKC("DatePicker", f, (f.min || f.max) ? rangeOf : null);
        if (f.min || f.max) ctrl.rangeOf = rangeOf;
        wrap.appendChild(ctrl.node);
      } else if (f.type === "textarea") {
        var ta = el("textarea", { flex: "1", minWidth: "0" });
        ta.value = f.value || "";
        ta.rows = 3;
        if (f.placeholder) ta.placeholder = f.placeholder;
        ta.addEventListener("input", function () { markDirty(); recompute(); });
        var taBox = ctlBox(ta, "area");
        ctrl = { input: ta, box: taBox, get: function () { return ta.value; } };
        wrap.appendChild(taBox);
      } else {
        var inp = el("input", null);
        inp.type = f.type === "number" ? "text" : (f.type || "text");
        if (f.type === "number" || f.suffix) { inp.style.textAlign = "right"; inp.style.fontVariantNumeric = "tabular-nums"; }
        if (f.type === "number") inp.inputMode = "decimal";
        inp.value = f.value != null ? f.value : "";
        if (f.placeholder) inp.placeholder = f.placeholder;
        var inBox = ctlBox(inp);
        if (f.suffix) inBox.appendChild(el("span", null, f.suffix)).className = "kc-sfx";
        var isNum = f.type === "number" && f.decimals !== null;   // decimals:null = 纯数字输入，不做千分位（如税率）
        // 数字：失焦千分位、聚焦还原；取值去逗号，自动计算与保存不受格式影响
        var dp = f.decimals != null ? f.decimals : 2;
        var fmtNum = function (raw) { var n = Number(String(raw).replace(/,/g, "")); return raw === "" || !isFinite(n) ? raw : n.toLocaleString("zh-CN", { minimumFractionDigits: dp, maximumFractionDigits: dp }); };
        if (isNum) {
          inp.value = fmtNum(inp.value);
          inp.addEventListener("focus", function () { inp.value = inp.value.replace(/,/g, ""); });
          inp.addEventListener("blur", function () { inp.value = fmtNum(inp.value); });
        }
        ctrl = { input: inp, box: inBox, get: function () { return isNum ? inp.value.replace(/,/g, "") : inp.value; } };
        if (f.auto) {
          // 已存有值视为人工确认值，不被自动结果覆盖
          ctrl.manual = f.value != null && f.value !== "";
          ctrl.setAuto = function (v) { if (v == null) return; var t = typeof v === "number" ? v.toFixed(2) : String(v); inp.value = isNum && document.activeElement !== inp ? fmtNum(t) : t; };
        }
        inp.addEventListener("input", function () {
          if (f.auto) ctrl.manual = true;
          if (ctrl.errorText) { ctrl.errorText = ""; inBox.classList.remove("err"); }
          renderMsg(ctrl); markDirty(); recompute();
        });
        if (f.check) ctrl.liveCheck = function (vals) {
          var v = ctrl.get();
          var msg = v === "" || v == null ? null : f.check(v, vals);
          ctrl.errorText = msg || (ctrl.errorText && ctrl.errorKind === "check" ? "" : ctrl.errorText);
          ctrl.errorKind = msg ? "check" : ctrl.errorKind;
          inBox.classList.toggle("err", !!ctrl.errorText);
          renderMsg(ctrl);
        };
        if (f.suffix === "元" || f.capital) attachCapital(inBox, inp);
        wrap.appendChild(inBox);
      }
      // 说明与错误共用一条预留行：出错时红字替换说明，行高不变（V-09）
      var err = el("div", { fontSize: "11.5px", lineHeight: "18px", color: "var(--ink-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, "");
      wrap.appendChild(err);
      ctrl.f = f; ctrl.wrap = wrap; ctrl.err = err;
      renderMsg(ctrl);
      ctrls.push(ctrl);
      grid.appendChild(wrap);
    });
    recompute();

    // —— 校验（必填双通道：红框 + 字段下红字 + system warning toast）——
    var validate = function () {
      var bad = [];
      ctrls.forEach(function (c) {
        var v = c.get();
        var isEmpty = !!c.f.required && (v === "" || v == null || (Array.isArray(v) && !v.length));
        var has = !isEmpty && v !== "" && v != null;
        var rg = has && c.rangeOf ? c.rangeOf() : null;
        var dup = (has && typeof c.f.check === "function" ? c.f.check(v, getAllVals()) : null)
          || (rg && rg.min && String(v) < rg.min ? c.f.label + "不能早于 " + rg.min + (c.f.minLabel ? "（" + c.f.minLabel + "）" : "") : null)
          || (rg && rg.max && String(v) > rg.max ? c.f.label + "不能晚于 " + rg.max + (c.f.maxLabel ? "（" + c.f.maxLabel + "）" : "") : null)
          || (has && typeof c.f.unique === "function" ? c.f.unique(v, getAllVals()) : null);
        var bad1 = isEmpty || !!dup;
        if (c.setError) c.setError(bad1);
        else if (c.box) c.box.classList.toggle("err", bad1);
        else if (c.input && c.input.style) c.input.style.borderColor = bad1 ? "var(--danger)" : "var(--line-strong)";
        c.errorText = isEmpty ? "请填写" + c.f.label : (dup || "");
        renderMsg(c);
        if (bad1) bad.push(c);
      });
      if (bad.length) {
        toast((bad[0].errorText || bad[0].f.label + "：为必填项") + (bad.length > 1 ? "（等 " + bad.length + " 处）" : ""), "warn");
        bad[0].input.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return !bad.length;
    };

    return { node: root, getVals: getVals, getAllVals: getAllVals, validate: validate, recompute: recompute, anchors: anchors,
      focusFirst: function () {
        var first = ctrls.find(function (c) { return c.f.type !== "readonly" && c.f.type !== "grid" && c.f.type !== "file" && c.input; });
        if (first) setTimeout(function () { try { var t = first.input.querySelector ? (first.input.querySelector("input,button,textarea") || first.input) : first.input; if (t.focus) t.focus(); } catch (e) {} }, 50);
      } };
  }

  // —— FormModal（字段表单弹窗 → onSave(values, action)）——
  // opts：{ title, subtitle, width, cols, fields, saveText, onSave(vals, action),
  //         actions:["draft","saveNew","saveSubmit"] 保存动作组（红圈五件套按需裁剪，默认 取消/保存） }
  // 字段契约见上方 buildFormBody。行为：首字段自动聚焦；dirty 后点遮罩/Esc 弹「放弃修改」确认；
  // 长表单 header/footer 吸底、字段区独立滚动；「保存草稿」未改动前置灰（红圈按钮三态）、跳过必填校验。
  function formModal(opts) {
    opts = opts || {};
    var dirty = false;
    var closed = false;
    var asking = false;
    var draftBtn = null;
    var close = function () { if (closed) return; closed = true; document.removeEventListener("keydown", onKey); ov.remove(); };
    var tryClose = function () {
      if (!dirty) return close();
      if (asking) return;
      asking = true;
      confirm({ title: "放弃修改？", message: "表单内容尚未保存，关闭后本次填写将丢失。", confirmText: "放弃修改", danger: true,
        onConfirm: close, onCancel: function () { asking = false; } });
    };
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); tryClose(); } };
    var ov = overlay(tryClose);
    ov.setAttribute("aria-label", opts.title || "编辑");
    var box = panel(opts.width || 480);
    Object.assign(box.style, { overflow: "hidden", display: "flex", flexDirection: "column" });
    header(box, opts.title || "编辑", opts.subtitle, tryClose);
    var fb = buildFormBody({ fields: opts.fields, cols: opts.cols, onDirty: function () {
      dirty = true;
      if (draftBtn) { draftBtn.disabled = false; draftBtn.style.opacity = "1"; draftBtn.style.cursor = "pointer"; }
    } });
    var bodyWrap = el("div", { padding: "18px 20px", overflowY: "auto", flex: "1 1 auto" });
    bodyWrap.appendChild(fb.node);
    box.appendChild(bodyWrap);
    var foot = el("div", { padding: "12px 20px 16px", display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid var(--line)", flex: "none", background: "var(--panel)" });
    var cancel = btn("取消");
    cancel.addEventListener("click", tryClose);
    foot.appendChild(cancel);
    var ACTION_LABEL = { draft: "保存草稿", saveNew: "保存并新建", saveSubmit: "保存并提交" };
    (opts.actions || []).forEach(function (a) {
      if (!ACTION_LABEL[a]) return;
      var b = btn(ACTION_LABEL[a]);
      if (a === "draft") { draftBtn = b; b.disabled = true; b.style.opacity = "0.45"; b.style.cursor = "not-allowed"; }   // 红圈：空表单草稿置灰
      b.addEventListener("click", function () {
        if (a === "draft" && !dirty) return;
        if (a !== "draft" && !fb.validate()) return;   // 草稿允许不完整（红圈：草稿可后补）
        var vals = fb.getVals();
        close(); if (opts.onSave) opts.onSave(vals, a);
      });
      foot.appendChild(b);
    });
    var save = btn(opts.saveText || "保存", "primary");
    save.addEventListener("click", function () {
      if (!fb.validate()) return;
      var vals = fb.getVals();
      close(); if (opts.onSave) opts.onSave(vals, "save");
    });
    foot.appendChild(save);
    box.appendChild(foot);
    ov.appendChild(box); document.body.appendChild(ov);
    document.addEventListener("keydown", onKey);
    fb.focusFirst();
  }

  // —— typeSelect（新建三段式第一段：业务类型单选弹窗 → Promise<value|null>）——
  // 红圈范本：新建付款申请 8 类型。opts:{ title, options:[{value,label,hint}], defaultValue }
  function typeSelect(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var picked = { v: opts.defaultValue || (opts.options && opts.options[0] && opts.options[0].value) };
      var done = function (v) { ov.remove(); resolve(v); };
      var ov = overlay(function () { done(null); });
      ov.setAttribute("aria-label", opts.title || "选择业务类型");
      var box = panel(opts.width || 460);
      header(box, opts.title || "选择业务类型", opts.subtitle || "先选类型，再填写对应表单", function () { done(null); });
      var body = el("div", { padding: "14px 16px", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "52vh", overflowY: "auto" });
      var items = [];
      (opts.options || []).forEach(function (o) {
        var it = el("button", { display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "10px", cursor: "pointer", textAlign: "left", color: "inherit", fontFamily: "inherit" });
        it.type = "button";
        it.setAttribute("aria-label", o.label);
        var dot = el("span", { width: "14px", height: "14px", borderRadius: "50%", border: "2px solid var(--line-strong)", flex: "none", boxSizing: "border-box" });
        var tx = el("div", null);
        tx.appendChild(el("div", { fontSize: "13px", fontWeight: "700" }, o.label));
        if (o.hint) tx.appendChild(el("div", { fontSize: "11.5px", color: "var(--ink-faint)", marginTop: "2px" }, o.hint));
        it.appendChild(dot); it.appendChild(tx);
        var paint = function () {
          var on = picked.v === o.value;
          it.setAttribute("aria-pressed", String(on));
          it.style.borderColor = on ? "var(--brand)" : "var(--line)";
          it.style.background = on ? "var(--brand-soft)" : "transparent";
          dot.style.borderColor = on ? "var(--brand)" : "var(--line-strong)";
          dot.style.background = on ? "radial-gradient(circle, var(--brand) 45%, transparent 50%)" : "transparent";
        };
        it.addEventListener("click", function () { picked.v = o.value; items.forEach(function (p) { p(); }); });
        it.addEventListener("dblclick", function () { done(o.value); });
        items.push(paint); paint();
        body.appendChild(it);
      });
      box.appendChild(body);
      var foot = el("div", { padding: "12px 20px 16px", display: "flex", justifyContent: "flex-end", gap: "8px", borderTop: "1px solid var(--line)" });
      var cancel = btn("取消");
      cancel.addEventListener("click", function () { done(null); });
      var ok = btn("确定", "primary");
      ok.addEventListener("click", function () { done(picked.v); });
      foot.appendChild(cancel); foot.appendChild(ok);
      box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
    });
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
    ov.setAttribute("aria-label", "选择文件夹");
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
    ov.setAttribute("aria-label", opts.title || "导出");
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
    ov.setAttribute("aria-label", opts.title || "Excel 导入");
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

  window.KitUI = { toast: toast, confirm: confirm, modal: modal, formModal: formModal, buildFormBody: buildFormBody, typeSelect: typeSelect, undoToast: undoToast, folderPicker: folderPicker, exportModal: exportModal, importModal: importModal };
  window.KitUIScreen = function () { return null; };
})();
