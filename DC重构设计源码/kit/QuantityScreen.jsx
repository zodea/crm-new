// QuantityScreen — 工程量矩阵（自定义浮动 tooltip + 丰富弹窗 + 跳工资明细）
(function () {
  const { Button, Panel, Icon, StatusChip } = window.DesignSystem_e3d871;

  function QuantityScreen({ data, navigate }) {
    const mx = data.matrix;
    const [building, setBuilding] = React.useState(mx.buildings[0]);
    const [months, setMonths] = React.useState(mx.months.map(m => m.key));
    const [hlEmpty, setHlEmpty] = React.useState(true);
    const [popup, setPopup] = React.useState(null);
    const [tooltip, setTooltip] = React.useState(null); // {x,y,blk,floor,unit}
    const monthByKey = Object.fromEntries(mx.months.map(m => [m.key, m]));
    const currentMonth = "2025-04";

    const toggleMonth = k => setMonths(ms => ms.includes(k) ? ms.filter(x=>x!==k) : [...ms,k]);

    const cfg = data.crewConfig;
    const priceFor = name => (cfg.items.find(it=>it.name===name)||{}).price || 0;

    const showTooltip = (e, blk, floor, unit) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({ x: rect.right + 8, y: rect.top - 8, blk, floor, unit });
    };

    const roomBreakdown = blk => {
      const rooms = blk.item === "墙砖" ? ["客厅","主卧","次卧","卫生间"] : ["客厅","厨房","阳台"];
      let rem = blk.qty, out = [];
      rooms.forEach((r,i) => {
        const q = i === rooms.length-1 ? rem : +(blk.qty/rooms.length*(0.8+0.4*((i+1)%2))).toFixed(2);
        rem = +(rem-q).toFixed(2);
        out.push({ room:r, contract:+(q*1.05).toFixed(2), field:q, provisional:q });
      });
      return out;
    };

    return (
      <div style={{ display:"flex",flexDirection:"column",gap:12,position:"relative" }}>
        {/* 浮动 Tooltip */}
        {tooltip && (
          <div style={{ position:"fixed",left:tooltip.x,top:tooltip.y,zIndex:100,width:260,background:"var(--panel)",border:"1px solid var(--line-strong)",borderRadius:10,boxShadow:"var(--shadow-pop)",padding:14,pointerEvents:"none" }}>
            <div style={{ fontSize:13,fontWeight:800,marginBottom:8 }}>{building} {tooltip.floor} · {tooltip.unit}</div>
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {[tooltip.blk].filter(Boolean).map((b,i) => {
                const m = monthByKey[b.month];
                const price = priceFor(b.item+"铺贴");
                const subtotal = +(b.qty * price).toFixed(0);
                return (
                  <div key={i} style={{ background:m.bg,borderRadius:7,padding:"8px 10px" }}>
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
                      <span style={{ fontSize:12,fontWeight:800,color:m.ink }}>{b.item}铺贴</span>
                      <span style={{ fontSize:11,color:m.ink }}>{m.label}</span>
                    </div>
                    <div style={{ fontSize:12,color:m.ink }}>工人 <strong>{b.worker}</strong>{b.partner && <span> / {b.partner}</span>}</div>
                    {b.partner && <div style={{ fontSize:11,color:m.ink,opacity:0.8 }}>夫妻关联·工程量各自独立</div>}
                    <div style={{ display:"flex",justifyContent:"space-between",marginTop:5,fontSize:12 }}>
                      <span style={{ color:m.ink }}>工程量 <strong>{b.qty} ㎡</strong></span>
                      {price > 0 && <span style={{ color:m.ink }}>≈ <strong>¥{subtotal.toLocaleString("zh-CN")}</strong></span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop:8,fontSize:11,color:"var(--ink-faint)" }}>点击格子查看房间明细</div>
          </div>
        )}

        {/* 控制栏 */}
        <Panel padding={12} style={{ display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
          <select style={{ border:"1px solid var(--line-strong)",borderRadius:8,padding:"7px 10px",fontSize:13,background:"#fff" }}>
            <option>合和新城 · 泥水A班</option><option>锦绣华庭 · 泥水B班</option>
          </select>
          <div style={{ display:"flex",gap:6 }}>
            {mx.buildings.map(b => (
              <button key={b} onClick={() => setBuilding(b)} style={{ border:"1px solid",borderColor:building===b?"var(--brand)":"var(--line)",background:building===b?"var(--brand)":"#fff",color:building===b?"#fff":"var(--ink)",borderRadius:8,padding:"7px 16px",fontSize:14,fontWeight:700,cursor:"pointer" }}>{b}</button>
            ))}
          </div>
          <div style={{ marginLeft:"auto",display:"flex",gap:8 }}>
            <Button size="sm" icon="upload">导入工程量</Button>
          </div>
        </Panel>

        <Panel padding={12} style={{ display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
          <span style={{ fontSize:12,fontWeight:800,color:"var(--ink-soft)" }}>月份</span>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            {mx.months.map(m => {
              const on = months.includes(m.key);
              const cur = m.key === currentMonth;
              return (
                <button key={m.key} onClick={() => toggleMonth(m.key)} style={{ display:"inline-flex",alignItems:"center",gap:7,border:"1px solid",borderColor:on?m.dot:"var(--line)",background:on?m.bg:"#fff",color:on?m.ink:"var(--ink-faint)",borderRadius:999,padding:"5px 12px",fontSize:13,fontWeight:cur?800:600,cursor:"pointer",boxShadow:cur&&on?"0 0 0 2px "+m.dot:"none" }}>
                  <span style={{ width:10,height:10,borderRadius:3,background:m.dot,display:"inline-block" }}></span>{m.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginLeft:"auto",display:"flex",gap:16 }}>
            <label style={{ display:"inline-flex",alignItems:"center",gap:6,fontSize:12,cursor:"pointer" }}><input type="checkbox" checked={hlEmpty} onChange={e=>setHlEmpty(e.target.checked)} />突出未施工</label>
          </div>
        </Panel>

        {/* 矩阵 */}
        <Panel padding={10}>
          <div style={{ overflow:"auto" }}>
            <table style={{ borderCollapse:"separate",borderSpacing:0,width:"100%",minWidth:640 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ position:"sticky",left:0,zIndex:2,background:"var(--surface-2)",border:"1px solid var(--line)",padding:"8px 14px",fontSize:12,fontWeight:800,color:"var(--ink-soft)",minWidth:64 }}>楼层</th>
                  {mx.units.map(u => (
                    <th key={u} style={{ background:"var(--surface-2)",border:"1px solid var(--line)",padding:"8px 10px",fontSize:13,fontWeight:800 }}>{u}</th>
                  ))}
                </tr>
                <tr>
                  {mx.units.map(u => (
                    <th key={u} style={{ background:"var(--surface-2)",border:"1px solid var(--line)",padding:"4px 6px" }}>
                      <div style={{ display:"flex",gap:8,justifyContent:"center",fontSize:11,color:"var(--ink-soft)",fontWeight:700 }}>
                        {mx.items.map(it=><span key={it} style={{ flex:1 }}>{it}</span>)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mx.floors.map(f => (
                  <tr key={f}>
                    <th style={{ position:"sticky",left:0,zIndex:1,background:"var(--panel)",border:"1px solid var(--line)",padding:"0 14px",fontSize:13,fontWeight:800,fontFamily:"var(--font-mono)",color:"var(--ink)" }}>{f}</th>
                    {mx.units.map(u => {
                      const blocks = mx.cells[f+"|"+u] || [];
                      return (
                        <td key={u} style={{ border:"1px solid var(--line)",padding:0,height:48 }}>
                          <div style={{ display:"flex",height:"100%" }}>
                            {mx.items.map((itName, bi) => {
                              const blk = blocks.find(b=>b.item===itName);
                              const visible = blk && months.includes(blk.month);
                              const m = blk ? monthByKey[blk.month] : null;
                              const empty = !blk;
                              const cur = blk && blk.month===currentMonth;
                              return (
                                <button key={itName}
                                  onMouseEnter={e => blk && showTooltip(e, blk, f, u)}
                                  onMouseLeave={() => setTooltip(null)}
                                  onClick={() => blk && setPopup({ floor:f, unit:u, blocks })}
                                  style={{
                                    flex:1, border:0, borderLeft:bi?"1px solid var(--line)":0,
                                    cursor:blk?"pointer":"default",
                                    background:visible?m.bg:empty?(hlEmpty?"repeating-linear-gradient(45deg,#fff,#fff 5px,#fef2f2 5px,#fef2f2 10px)":"#fff"):"#f3f4f6",
                                    color:visible?m.ink:"var(--ink-faint)",
                                    outline:cur&&visible?"2px solid "+m.dot:"none", outlineOffset:-2,
                                    boxShadow:empty&&hlEmpty?"inset 0 0 0 1px var(--danger)":"none",
                                    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,
                                    fontSize:12.5,fontWeight:700,lineHeight:1.1,
                                  }}>
                                  {blk
                                    ? <><span>{blk.worker.length>3?blk.worker.slice(0,2):blk.worker}{blk.partner&&<span style={{ fontSize:9,opacity:0.7 }}>·{blk.partner.slice(0,1)}</span>}</span></>
                                    : <span style={{ fontSize:11,color:hlEmpty?"var(--danger)":"var(--ink-faint)" }}>—</span>}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:16,marginTop:10,fontSize:12,color:"var(--ink-soft)",flexWrap:"wrap" }}>
            <span>图例：</span>
            {mx.months.map(m => <span key={m.key} style={{ display:"inline-flex",alignItems:"center",gap:5 }}><span style={{ width:12,height:12,borderRadius:3,background:m.bg,border:"1px solid "+m.dot }}></span>{m.label}</span>)}
            <span style={{ display:"inline-flex",alignItems:"center",gap:5 }}><span style={{ width:12,height:12,borderRadius:3,background:"repeating-linear-gradient(45deg,#fff,#fff 3px,#fef2f2 3px,#fef2f2 6px)",border:"1px solid var(--danger)" }}></span>未施工</span>
            <span style={{ marginLeft:"auto" }}>hover 查看工人 · 点击查看房间明细</span>
          </div>
        </Panel>

        {/* 弹窗 */}
        {popup && (
          <div onClick={() => setPopup(null)} style={{ position:"fixed",inset:0,zIndex:50,background:"rgba(16,24,40,0.45)",display:"grid",placeItems:"center",padding:24 }}>
            <Panel onClick={e=>e.stopPropagation()} padding={0} style={{ width:580,maxWidth:"100%",maxHeight:"88vh",overflow:"auto",boxShadow:"var(--shadow-pop)" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",borderBottom:"1px solid var(--line)",position:"sticky",top:0,background:"var(--panel)" }}>
                <div style={{ fontSize:15,fontWeight:800 }}>{building} · {popup.floor} · {popup.unit} <span style={{ fontSize:12,color:"var(--ink-soft)",fontWeight:600 }}>房间明细</span></div>
                <button onClick={()=>setPopup(null)} style={{ border:0,background:"transparent",cursor:"pointer",color:"var(--ink-soft)" }}><Icon name="x" size={20} /></button>
              </div>
              <div style={{ padding:18,display:"flex",flexDirection:"column",gap:18 }}>
                {popup.blocks.map(blk => {
                  const m = monthByKey[blk.month];
                  const price = priceFor(blk.item+"铺贴");
                  const subtotal = +(blk.qty * price).toFixed(0);
                  const rooms = roomBreakdown(blk);
                  const roomTotal = rooms.reduce((s,r)=>s+r.provisional,0);
                  return (
                    <div key={blk.item}>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
                        <span style={{ fontSize:14,fontWeight:800 }}>{blk.item}铺贴</span>
                        <StatusChip tone="brand">{blk.worker}{blk.partner?"／"+blk.partner:""}</StatusChip>
                        <span style={{ display:"inline-flex",alignItems:"center",gap:5,fontSize:12,color:"var(--ink-soft)" }}><span style={{ width:9,height:9,borderRadius:2,background:m.dot }}></span>{m.label}</span>
                        {price > 0 && <span style={{ marginLeft:"auto",fontSize:13,fontWeight:800,color:"var(--brand)" }}>≈ ¥{subtotal.toLocaleString("zh-CN")}</span>}
                      </div>
                      {blk.partner && <div style={{ fontSize:11,color:"var(--ink-faint)",marginBottom:8 }}>夫妻关联 — 工程量与工资独立核算，此处仅显示 {blk.worker} 工程量</div>}
                      <table style={{ width:"100%",borderCollapse:"collapse" }}>
                        <thead><tr>
                          {["房间","合同量","现场量","暂定量","小计"].map((h,i)=><th key={h} style={{ padding:"6px 10px",fontSize:11,fontWeight:800,color:"var(--ink-soft)",background:"var(--surface-2)",textAlign:i?"right":"left" }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {rooms.map(r => (
                            <tr key={r.room} style={{ borderBottom:"1px solid var(--line)" }}>
                              <td style={{ padding:"7px 10px",fontSize:13 }}>{r.room}</td>
                              <td style={{ padding:"7px 10px",fontSize:13,textAlign:"right",fontFamily:"var(--font-mono)",color:"var(--ink-soft)" }}>{r.contract}</td>
                              <td style={{ padding:"7px 10px",fontSize:13,textAlign:"right",fontFamily:"var(--font-mono)" }}>{r.field}</td>
                              <td style={{ padding:"7px 10px",fontSize:13,textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:700 }}>{r.provisional}</td>
                              <td style={{ padding:"7px 10px",fontSize:13,textAlign:"right",fontFamily:"var(--font-mono)",color:"var(--brand)" }}>{price>0?("¥"+(r.provisional*price).toFixed(0)):"—"}</td>
                            </tr>
                          ))}
                          <tr style={{ borderTop:"2px solid var(--line-strong)" }}>
                            <td style={{ padding:"8px 10px",fontWeight:800 }}>合计</td>
                            <td colSpan={2}></td>
                            <td style={{ padding:"8px 10px",textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:"var(--brand)" }}>{roomTotal.toFixed(2)} ㎡</td>
                            <td style={{ padding:"8px 10px",textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:800,color:"var(--brand)" }}>{price>0?("¥"+subtotal.toLocaleString("zh-CN")):"—"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                {/* 扣款摘要 */}
                <div style={{ padding:"10px 12px",background:"#fef2f2",borderRadius:8,fontSize:12,color:"var(--danger)" }}>
                  扣款记录：空鼓罚款 ¥600 · 未收尾扣款 ¥600（已在工资核算中体现）
                </div>
                <div style={{ display:"flex",justifyContent:"flex-end",gap:8 }}>
                  <Button size="sm" icon="arrow-right" onClick={() => { setPopup(null); navigate("payrollDetail",{ worker: popup.blocks[0]?.worker, crew:"泥水A班", project:"合和新城" }); }}>
                    查看 {popup.blocks[0]?.worker} 工资明细
                  </Button>
                </div>
              </div>
            </Panel>
          </div>
        )}
      </div>
    );
  }
  window.QuantityScreen = QuantityScreen;
})();
