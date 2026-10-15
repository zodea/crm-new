"""Build the local, offline issue review from curated rows and a fresh tracker snapshot."""
import argparse
import datetime
import html
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
LABELS = {"local-done": "本地完成 · 未推送", "partial": "部分完成", "in-progress": "正在实施", "planned": "已定稿 · 待开发", "decision": "待你裁定"}


def esc(value):
    return html.escape(str(value), quote=True)


def repo_link(path):
    return "../../../" + quote(path.replace("\\", "/"), safe="/")


def bullets(items):
    def linked(item):
        parts = re.split(r'(https://github\.com/zodea/crm-new/issues/\d+(?:#issuecomment-\d+)?)', str(item))
        return ''.join(
            f'<a href="{esc(part)}" target="_blank" rel="noreferrer">查看 Issue 记录 ↗</a>'
            if index % 2 else esc(part)
            for index, part in enumerate(parts)
        )
    return "<ul>" + "".join(f"<li>{linked(item)}</li>" for item in items) + "</ul>"


def flow_svg(row):
    if row.get('graph'):
        return branch_flow_svg(row)
    # A vertical flow leaves room for a visible failure-and-return path on the right.
    nodes = row["flow"]
    height = len(nodes) * 84 + 30
    svg = [f'<svg class="flow" viewBox="0 0 820 {height}" role="img" aria-label="Issue {row["number"]} 流程及异常返回">',
           '<defs><marker id="arrow'+str(row["number"])+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#668077"/></marker></defs>']
    for i, node in enumerate(nodes):
        y = i * 84 + 12
        if i:
            svg.append(f'<path d="M220 {y-24}V{y-2}" stroke="#668077" stroke-width="2" marker-end="url(#arrow{row["number"]})"/>')
        svg.append(f'<rect x="28" y="{y}" width="390" height="60" rx="9" fill="#fff" stroke="#aac0b8"/><text x="46" y="{y+23}" font-size="12" fill="#63736e">{i+1:02d}</text>')
        chunks = [node[j:j+22] for j in range(0, len(node), 22)]
        for k, chunk in enumerate(chunks[:2]):
            svg.append(f'<text x="79" y="{y+25+k*21}" font-size="15" fill="#203d34">{esc(chunk)}</text>')
    ex = row["exception"]
    y1, y2 = ex["at"]*84+42, ex["returnTo"]*84+42
    svg.append(f'<path d="M418 {y1}H454V{y2}H422" fill="none" stroke="#b47438" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#arrow{row["number"]})"/>')
    box_y = max(12, min(y1-24, height-142))
    svg.append(f'<rect x="474" y="{box_y}" width="326" height="128" rx="10" fill="#fff3df"/><text x="492" y="{box_y+24}" font-size="12" fill="#875724">异常 / 退回路径</text>')
    for k, chunk in enumerate([ex["label"][j:j+19] for j in range(0,len(ex["label"]),19)][:4]):
        svg.append(f'<text x="492" y="{box_y+48+k*20}" font-size="14" fill="#583f29">{esc(chunk)}</text>')
    svg.append('</svg>')
    return ''.join(svg)


def branch_flow_svg(row):
    graph = row['graph']
    marker = f'branch-arrow-{row["number"]}'
    nodes = {node['id']: node for node in graph['nodes']}
    assert len(nodes) == len(graph['nodes']), 'duplicate branch node'
    svg = [f'<svg class="flow flow-branches" viewBox="0 0 {graph["width"]} {graph["height"]}" role="img" aria-label="Issue {row["number"]} 独立来源分支及异常返回">',
           f'<defs><marker id="{marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#668077"/></marker></defs>']
    for edge in graph['edges']:
        assert edge['from'] in nodes and edge['to'] in nodes, 'missing branch target'
        color = '#b47438' if edge.get('exception') else '#668077'
        dashed = ' stroke-dasharray="6 4"' if edge.get('exception') else ''
        svg.append(f'<path d="{esc(edge["path"])}" fill="none" stroke="{color}" stroke-width="2"{dashed} marker-end="url(#{marker})"/>')
    for node in nodes.values():
        x, y, width, height = node['x'], node['y'], node['width'], node['height']
        assert x >= 0 and y >= 0 and x+width <= graph['width'] and y+height <= graph['height']
        assert len(node['lines'])*22+53 <= height, 'branch text exceeds node height'
        fill = '#fff3df' if node.get('warning') else '#fff'
        svg.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="9" fill="{fill}" stroke="#aac0b8"/>')
        svg.append(f'<text x="{x+16}" y="{y+25}" font-size="15" font-weight="600" fill="#203d34">{esc(node["title"])}</text>')
        for i, line in enumerate(node['lines']):
            assert len(line)*14 <= width-32, 'branch label would be clipped'
            svg.append(f'<text x="{x+16}" y="{y+50+i*22}" font-size="14" fill="#52665d">{esc(line)}</text>')
    svg.append('</svg>')
    return ''.join(svg)


def overview(rows):
    statuses = {str(row['number']): row['status'] for row in rows}
    lanes = [
        ("收入", [("甲方变更 / 报量 / 验收 / 结算", "410", "partial"), ("发票与普通收款", "413", "partial"), ("客户 / 项目 / 合同累计", "436", "local-done")]),
        ("材料", [("原件 → 人工核对 → 逻辑归档", "441", "in-progress"), ("有效到货 → 入仓 / 领用 / 调拨", "411", "partial"), ("材料结算 → 发票 → 付款", "409", "partial")]),
        ("现场", [("区域 / 模板 / 责任 / 完成事实", "442", "in-progress"), ("排程与月报，按原来源回读", "412", "partial"), ("真实施工完成 → A 工资来源", "412", "partial")]),
        ("工资", [("按格式选择：A 完成 / C1 考勤 / C2 签工", "412", "partial"), ("个人或主体标准 → 草稿 → 核对", "412", "partial"), ("实际分配 → 发放冻结 → 独立更正", "412", "partial")]),
        ("分包及其他支出", [("分包合同 → 变更 → 确认结算", "410", "partial"), ("罚扣抵扣 / 报销 / 辅助结算", "413", "partial"), ("付款申请 → 批复 → 实际支付", "413", "partial")]),
    ]
    top = '<div class="global-start"><a href="#issue-407">客户 / 分供方 / 班组 / 工人<br><small>#407 · 主档与身份</small></a><span>→</span><a href="#issue-408">项目与合作关系<br><small>#408 · 归属与来源</small></a><span>→</span><a href="#issue-409">按业务选择合同与清单依据<br><small>#409 · 适用时进入</small></a></div><div class="branch-caption">↓ 按业务分支流转；C1 可从已有项目归属的工人直接登记考勤，不依赖工程量或排程 ↓</div><div class="lanes">'
    for title, nodes in lanes:
        top += f'<div class="lane"><h3>{title}</h3>'
        for i, (label, number, status) in enumerate(nodes):
            status = statuses[number]
            top += ('<div class="down">↓</div>' if i else '') + f'<a class="lane-node {status}" href="#issue-{number}">{label}<small>#{number} · {LABELS[status]}</small></a>'
        top += '</div>'
    return top + '</div><div class="crosslinks">工程量完成事实 → 甲方月报　｜　合格到货 → 材料结算　｜　已确认结算 → 付款候选　｜　工资计成本须防止重复计入银行支付</div><div class="global-end"><strong>项目经营 / 动态成本 / 余额</strong><p>读取各源单当前有效事实 → 点击指标下钻 → 按本类规则更正 → 返回重新核对</p><p class="amber">整条跨模块链仍未全部验收；普通收款等已完成子链不能代表全链完成。</p></div><div class="production"><a href="#issue-416">#416 后置关口：正式保存 → 备份与恢复演练 → 部署验收</a><span>待你裁定，尚未上线</span></div>'


def overview_screens():
    samples = [
        (447, '主档分支：人工核对证照并回读税号', 'docs/design/evidence/issue-447/06-confirmed-master-readback-1440.png'),
        (424, '从客户进入同一项目', 'docs/design/evidence/issue-424/customer-project-1280.png'),
        (425, '回读施工合同与客户关系', 'docs/design/evidence/issue-425/customer-contract-1280.png'),
        (412, '预算分支：维护七科目并保留版本身份', 'docs/design/evidence/issue-412-target-cost/browser/seven-category-edit-1440.png'),
        (442, '维护施工阶段及报量映射', 'docs/design/evidence/issue-442/stages/stages-1440.png'),
        (444, '排程分支：中央计划与阶段进度', 'docs/design/evidence/issue-444/contract/central-wbs-1440.png'),
        (444, '从首页来源查看同一工序进度', 'docs/design/evidence/issue-444/provisional/home-source-readonly-1440.png'),
        (445, '暂估后补合同：核对原冻结量与当前合同来源', 'docs/design/evidence/issue-445/browser/comparison-lower-and-confirm-1440.png'),
        (445, '绑定后回读原楼层计划与冻结来源', 'docs/design/evidence/issue-445/browser/original-floor-readonly-390.png'),
        (442, '核对月报基准并冻结申报', 'docs/design/evidence/issue-442/monthly/monthly-submitted-snapshot.png'),
        (412, '工资分支：接管后核对当时冻结的工资与分配', 'docs/design/evidence/issue-412-payroll-history/browser/healthy-frozen-detail-1440.png'),
        (412, '工资历史缺口：原表金额与冻结未知分别说明', 'docs/design/evidence/issue-412-payroll-history/browser/missing-snapshot-original-head-390.png'),
        (412, 'A 工资：从真实完成量进入首张草稿', 'docs/design/evidence/issue-412-payroll-a/browser/first-payroll-from-quantity-1440.png'),
        (412, 'A 工资：分别保存主体比例与工资单价', 'docs/design/evidence/issue-412-payroll-a/browser/subject-price-configuration-390.png'),
        (412, 'A 工资：实发后冷读冻结工资及全部成员分配', 'docs/design/evidence/issue-412-payroll-a/browser/released-frozen-output-1440.png'),
        (412, 'A 工资：另一笔实发后，本单保留输入并重新核对', 'docs/design/evidence/issue-412-payroll-a/browser/rechecked-allocation-retained-390.png'),
        (412, 'C1 考勤：原工时与月底合计保精度', 'docs/design/evidence/issue-412-payroll-c1/browser/month-normal-totals-390.png'),
        (412, 'C1 工资：逐人标准与实际核算分别核对', 'docs/design/evidence/issue-412-payroll-c1/browser/c1-draft-source-values-390.png'),
        (412, 'C1 发放：冷读同次工资与考勤配对输出', 'docs/design/evidence/issue-412-payroll-c1/browser/released-paired-output-1440.png'),
        (441, '材料分支：对照原件人工核对送货', 'docs/design/evidence/issue-441/delivery-form-1440.png'),
        (436, '收入分支：保存后回读普通收款', 'docs/design/evidence/issue-436/receipt-detail-1440.png'),
        (412, '回看预算与真实来源；来源未齐时余额保持未知', 'docs/design/evidence/issue-412-target-cost/browser/actual-source-completeness-1440.png'),
    ]
    result = '<details open><summary>完整流程的交互画面</summary><p class="muted"><small>以下为各段独立合成数据验收的实际画面，用于核对入口与结果；不表示同一笔业务已贯穿全部模块。完整链的缺口仍见总图。</small></p><div class="image-grid">'
    for number, caption, path in samples:
        assert (ROOT / path).is_file(), f'missing overview evidence: {path}'
        result += f'<figure><a href="{repo_link(path)}" target="_blank" rel="noreferrer"><img loading="lazy" src="{repo_link(path)}" alt="{esc(caption)}"></a><figcaption><a href="#issue-{number}">#{number} · {esc(caption)}</a></figcaption></figure>'
    return result + '</div></details>'


CSS = '''
:where(main,.diagram-layout>section,.flow-scroll,.results>section){min-width:0}
.results li{overflow-wrap:anywhere}
.planned{background:#ecebf4;color:#61577e}.stats{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))!important}
:root{font-family:"Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;color:#233a33;background:#f4f3ed;font-synthesis:none;line-height:1.65}*{box-sizing:border-box}body{margin:0}a{color:#21675a;text-decoration-thickness:1px;text-underline-offset:3px}button,input,select,textarea{font:inherit}button,a,input,select,textarea{outline-offset:4px}button{cursor:pointer;border:1px solid #bcc9c2;background:#fff;border-radius:6px;padding:7px 13px;color:#244c3d}button:hover{background:#e6eee8}.shell{max-width:1600px;margin:auto;display:grid;grid-template-columns:255px minmax(0,1fr);gap:34px;padding:28px}aside{position:sticky;top:24px;align-self:start;height:calc(100vh - 50px);display:flex;flex-direction:column;gap:12px}.brand{font-size:13px;letter-spacing:.13em;color:#647c6b}.rail-title{font-size:22px;margin:0}aside input,aside select{min-width:0;width:100%;padding:9px;border:1px solid #c7d1ca;background:#fff;border-radius:5px}.issue-nav{overflow:auto;min-height:80px;flex:1}.issue-nav a{display:block;text-decoration:none;color:#476055;padding:9px 7px;border-bottom:1px solid #e0e3d9;font-size:12px}.issue-nav a:hover{background:#e4ebe3}.issue-nav b{display:inline-block;min-width:42px;color:#274d3c}.intro{padding:24px 0 28px;border-bottom:2px solid #254d3e}.kicker{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#7b674c}h1{font-size:clamp(27px,3vw,42px);line-height:1.25;font-weight:600;margin:10px 0 20px}h2{font-size:24px;line-height:1.4;font-weight:600}h3{font-size:16px;margin:0 0 12px}p{margin:8px 0 14px}.muted,small{color:#65786e}.intro p{max-width:850px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.stat{border-top:1px solid #aebdad;padding:12px 4px}.stat strong{font-size:30px;margin-right:10px}.legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px}.badge{display:inline-block;border-radius:4px;padding:4px 8px;background:#ece8dd;color:#6d6246;font-size:12px}.local-done{background:#e8f1e7;color:#285b39}.partial{background:#f5ead9;color:#805b2c}.in-progress{background:#e3edf7;color:#2b5678}.decision{background:#f4e1df;color:#8b4842}.panel,.issue{background:#fdfcf8;border:1px solid #d9dfd1;padding:28px;margin:26px 0;border-radius:10px;scroll-margin-top:18px}.notice{border-left:3px solid #ab7843;padding:8px 14px;background:#fcf1df;color:#735335}.global-start{display:grid;grid-template-columns:1fr 26px 1fr 26px 1fr;align-items:center;text-align:center;gap:8px}.global-start a{background:#e5ece2;padding:17px 8px;border:1px solid #b8c8b1;border-radius:7px;text-decoration:none;font-weight:600}.global-start small{font-weight:400;font-size:11px}.branch-caption{text-align:center;padding:16px 0;color:#6b7d68;font-size:12px}.lanes{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.lane{padding:15px 10px;background:#f2f2e9;border-top:2px solid #93ab90}.lane h3{font-size:14px;text-align:center}.lane-node{display:block;text-align:center;padding:15px 8px;min-height:100px;text-decoration:none;border:1px solid #d8ded4;border-radius:5px;font-size:13px}.lane-node small{display:block;font-size:10px;margin-top:7px}.down{text-align:center;color:#8aa180}.crosslinks{margin:18px 0;font-size:12px;color:#66725d;border-top:1px dashed #a4b296;border-bottom:1px dashed #a4b296;padding:12px}.global-end{border:1px solid #9ead9a;text-align:center;background:#edf0e6;padding:17px}.global-end p{font-size:13px;margin:5px}.amber{color:#876137}.production{margin-top:15px;border:1px dashed #b57d6e;padding:13px;font-size:13px}.production span{display:block;color:#975846}.issue-head{display:flex;align-items:flex-start;gap:16px;justify-content:space-between}.issue-head h2{margin:3px 0 8px}.issue-id{font-size:13px;letter-spacing:.06em}.source-links{font-size:12px;margin-bottom:20px}.results{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0}.results section{padding:16px 20px;background:#f1f4eb}.results section:last-child{background:#f9f0e0}ul{margin:8px 0;padding-left:20px}li{margin:7px 0;font-size:13px}.diagram-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(230px,.8fr);gap:22px;align-items:start}.flow{display:block;width:100%;height:auto;min-width:560px}.flow-scroll{overflow:auto;background:#f3f5ee;border-radius:8px;padding:10px}.flow-scroll:focus{outline:2px solid #467a59}.sim{background:#edf0e8;border:1px solid #c2cdbb;border-radius:8px;overflow:hidden}.sim-bar{background:#294b3b;color:#fff;padding:11px 16px;font-size:12px}.sim-content{padding:20px;min-height:210px}.sim-title{font-size:19px;font-weight:600;margin:0 0 18px}.sim-label{font-size:11px;color:#6d7c63;margin:12px 0 5px}.sim-action{background:#fff;border:1px solid #cbd5c2;padding:12px;border-radius:5px;font-size:13px}.sim-result{background:#e0ead9;border-left:3px solid #6c9960;padding:12px;font-size:13px;margin-top:14px}.sim-controls{display:flex;justify-content:space-between;padding:12px 16px;border-top:1px solid #cbd5c2;gap:8px}.sim-controls span{font-size:12px;align-self:center}.image-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.image-grid figure{margin:0;border:1px solid #dce2d4;padding:8px;background:#fff}.image-grid img{width:100%;height:230px;object-fit:contain;object-position:top;background:#eaf0e8}.image-grid figcaption{font-size:11px;overflow-wrap:anywhere;padding:8px 0}.links{font-size:12px;display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.notes{margin-top:25px;padding-top:18px;border-top:1px solid #dae0d0}.notes label{font-size:13px;display:block;margin-bottom:6px}.notes textarea{width:100%;resize:vertical;min-height:76px;padding:12px;border:1px solid #c6d2bd;background:#fffef9;border-radius:5px}.saved{font-size:11px;color:#788a6a}details{margin:15px 0}summary{cursor:pointer;font-size:14px;font-weight:600}.grill-item{padding:16px 0;border-bottom:1px solid #e0dfd4}.grill-item p{font-size:14px}.reading-guide{display:flex;gap:12px;flex-wrap:wrap;font-size:13px}.empty{padding:30px;text-align:center}.sticky-alert{font-size:11px;padding:10px;background:#e7eddf}footer{font-size:12px;color:#7b8770;padding:20px 0 50px}.off{display:none!important}@media(max-width:1080px){.shell{grid-template-columns:210px minmax(0,1fr);padding:20px;gap:20px}.diagram-layout{grid-template-columns:1fr}.lanes{grid-template-columns:repeat(2,1fr)}.panel,.issue{padding:22px}}@media(max-width:700px){.shell{display:block;padding:14px}aside{position:static;height:auto;display:grid;grid-template-columns:1fr 1fr}.brand,.rail-title,.issue-nav,.sticky-alert{display:none}aside>a,aside>button{font-size:12px}.intro{padding-top:20px}.stats{grid-template-columns:1fr 1fr}.panel,.issue{padding:16px}.results,.image-grid{grid-template-columns:1fr}.global-start{display:flex;flex-direction:column}.global-start a{width:100%}.global-start span{transform:rotate(90deg)}.lanes{grid-template-columns:1fr 1fr}.issue-head{display:block}.image-grid img{height:250px}}@media print{aside,.sim-controls,.notes,.reading-guide,.filter-count{display:none!important}.shell{display:block;padding:0}.issue,.panel{break-inside:avoid}.off{display:block!important}.flow{min-width:0}.image-grid img{height:190px}body{background:white}.lanes{grid-template-columns:repeat(4,1fr)}a{color:inherit}}
'''

CSS += '''
.diagram-layout:has(.flow-branches){grid-template-columns:minmax(0,1fr)}
.flow.flow-branches{min-width:1000px}
@media(min-width:1081px){.lanes{grid-template-columns:repeat(5,minmax(0,1fr))}}
@media(max-width:1080px){.lanes .lane:last-child{grid-column:1 / -1}}
@media print{.flow.flow-branches{min-width:0}.lanes{grid-template-columns:repeat(5,minmax(0,1fr))}.lanes .lane:last-child{grid-column:auto}}
'''

JS = '''
const data=JSON.parse(document.getElementById('review-data').textContent);
const search=document.getElementById('search'),status=document.getElementById('status');
function filter(){let count=0;const term=search.value.trim().toLowerCase(),numeric=/^#?[0-9]+$/.test(term);document.querySelectorAll('.issue').forEach(el=>{const matches=numeric?el.id==='issue-'+term.replace('#',''):!term||el.textContent.toLowerCase().includes(term);const show=(!status.value||el.dataset.status===status.value)&&matches;el.classList.toggle('off',!show);document.querySelector('[data-nav="'+el.id+'"]').classList.toggle('off',!show);if(show)count++});document.getElementById('filter-count').textContent='当前显示 '+count+' / '+data.length+' 个 Issue'}
search.addEventListener('input',filter);status.addEventListener('change',filter);
function jump(){const id=location.hash.slice(1),el=document.getElementById(id);if(el?.classList.contains('issue')){search.value='';status.value='';filter();el.scrollIntoView({behavior:'smooth',block:'start'})}}
addEventListener('hashchange',jump);
const screens=new Map(data.map(row=>[String(row.number),row.screens]));
function drawSim(el,index){const list=screens.get(el.dataset.number);index=(index+list.length)%list.length;el.dataset.index=index;const screen=list[index];el.querySelector('.sim-title').textContent=screen.title;el.querySelector('.sim-action').textContent=screen.action;el.querySelector('.sim-result').textContent=screen.result;el.querySelector('.sim-count').textContent=(index+1)+' / '+list.length}
document.querySelectorAll('.sim').forEach(el=>{drawSim(el,0);el.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>drawSim(el,Number(el.dataset.index)+Number(button.dataset.step))))});
const storageKey='crm-issue-review-2026-09-11';let notes={};try{notes=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
document.querySelectorAll('textarea[data-note]').forEach(el=>{el.value=notes[el.dataset.note]||'';el.addEventListener('input',()=>{notes[el.dataset.note]=el.value;try{localStorage.setItem(storageKey,JSON.stringify(notes));document.getElementById('note-status').textContent='意见已保存在当前浏览器，可导出交给我'}catch{document.getElementById('note-status').textContent='当前浏览器不能自动保存，请使用导出意见按钮'}})});
document.getElementById('export-notes').addEventListener('click',()=>{const body=JSON.stringify({report:'CRM Issue 审阅 2026-09-11',exportedAt:new Date().toISOString(),notes},null,2),url=URL.createObjectURL(new Blob([body],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='CRM-Issue审阅意见.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)});
document.getElementById('print-report').addEventListener('click',()=>window.print());filter();jump();
'''


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--issues', required=True, type=Path)
    args=parser.parse_args()
    source=json.loads(args.issues.read_text(encoding='utf-8-sig'))
    issues={x['number']:x for x in source}
    rows=[]
    for filename in sorted(HERE.glob('rows-*.json')):
        rows.extend(json.loads(filename.read_text(encoding='utf-8-sig')))
    assert len(rows)==len({r['number'] for r in rows}), 'duplicate issue'
    assert set(issues)=={r['number'] for r in rows}, f'missing: {set(issues)-{r["number"] for r in rows}}'
    rows.sort(key=lambda r:r['number'])
    for r in rows:
        assert r['status'] in LABELS
        assert 0<=r['exception']['at']<len(r['flow']) and 0<=r['exception']['returnTo']<len(r['flow'])
        assert r['screens'] and r['flow']
        assert all(len(node) <= 44 for node in r['flow']), f'flow label would be clipped: #{r["number"]}'
        assert len(r['exception']['label']) <= 76, f'exception label would be clipped: #{r["number"]}'
        for path in r['evidence']:
            assert (ROOT/path).is_file(), f'missing evidence: {path}'
        r.update(title=issues[r['number']]['title'],url=issues[r['number']]['url'])
        r['comments']=[c['url'] for c in issues[r['number']]['comments']]
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    divergence=subprocess.check_output(['git','rev-list','--left-right','--count','HEAD...origin/main'],cwd=ROOT,text=True).split()
    stamp=datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    counts={key:sum(r['status']==key for r in rows) for key in LABELS}
    parts=['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>瑞航 CRM · 逐 Issue 流程与交互审阅</title><style>'+CSS+'</style></head><body><div class="shell"><aside><div class="brand">RUIHANG / CRM REVIEW</div><h2 class="rail-title">逐项审阅</h2><input id="search" aria-label="搜索 Issue 或问题" placeholder="搜索编号、模块、问题"><select id="status" aria-label="按状态筛选"><option value="">全部状态</option>'+''.join(f'<option value="{k}">{v}</option>' for k,v in LABELS.items())+'</select><a href="#overview">完整业务流程</a><a href="#grill">需要你决定的问题</a><nav class="issue-nav" aria-label="Issue 目录">']
    parts += [f'<a data-nav="issue-{r["number"]}" href="#issue-{r["number"]}"><b>#{r["number"]}</b>{esc(r["title"])}</a>' for r in rows]
    parts += ['</nav><button id="export-notes">导出我的审阅意见</button><button id="print-report">打印 / 另存 PDF</button><div class="sticky-alert">绿色仅表示本地限定切片完成。全部 Issue 当前仍开放；本报告不是上线声明。</div></aside><main><header class="intro"><div class="kicker">Development review · 2026 / 09 / 11</div><h1>瑞航 CRM<br>从每一张单据，看到完整业务链</h1><p>逐项查看已解决的问题、正常流程、异常退回和交互结果。实际运行截图来自已归档证据；没有实测画面的项目提供明确标注的交互示意。</p><div class="reading-guide"><a href="#overview">先看全流程 →</a><a href="#grill">查看待裁定 →</a><a href="#issue-436">查看已完成示例 #436 →</a><a href="#issue-442">查看工程量 #442 →</a></div><div class="stats">']
    parts += [f'<div class="stat"><strong>{counts[k]}</strong><small>{v}</small></div>' for k,v in LABELS.items()]
    parts += [f'</div><p class="muted">快照生成：{stamp} · 本地提交 {head[:8]} · 当前 {len(rows)} 个开放 Issue</p><p class="notice">按当前本地远端引用比较：领先 {divergence[0]} 个提交，落后 {divergence[1]} 个。远端获取、冲突及开放 PR 的实际核查时间见分支整合记录。本轮本地提交尚未推送或部署；各项已验收范围与剩余工作见下方。</p></header><section class="panel" id="overview"><h2>完整业务流程 · 已定方向与当前缺口</h2><p class="muted">每个方框可点击跳到对应 Issue。箭头表达业务依赖，不等于该路径已经全部实现。</p>'+overview(rows)+overview_screens()+'<details><summary>完整交互顺序：从入口到更正后回读</summary><div class="global-start"><a href="#issue-404">列表筛选 → 只读详情</a><span>→</span><a href="#issue-405">整页编辑 → 校验 → 保存</a><span>→</span><a href="#issue-435">回读结果 → 下钻 → 返回</a></div><p class="notice">保存失败保留草稿；来源失效不展示旧金额；已生效单据按本类规则更正；返回恢复原项目、月份和筛选。工资、材料、款项各自保留事实，汇总只读源单。</p></details><div class="notes"><label for="note-overview">全流程哪些地方不顺畅？</label><textarea id="note-overview" data-note="overall" placeholder="例如：某处缺入口、状态跳得太快、金额来源不明……"></textarea></div></section><section class="panel" id="grill"><h2>需要你裁定的业务问题</h2><p>这里只集中真实业务取舍。技术缺口继续列在各 Issue 的剩余工作中，由我处理。</p>']
    seen=set()
    for r in rows:
        if r['number'] in (427, 439):
            continue  # These point to the same decisions already listed under their parent issues.
        for q in r['questions']:
            if q in seen: continue
            seen.add(q)
            parts.append(f'<div class="grill-item"><a href="#issue-{r["number"]}">#{r["number"]} · {esc(r["title"])}</a><p>{esc(q)}</p></div>')
    parts.append('</section><p class="filter-count" id="filter-count"></p>')
    for r in rows:
        n=r['number']
        parts.append(f'<article class="issue" id="issue-{n}" data-status="{r["status"]}"><div class="issue-head"><div><a class="issue-id" href="{r["url"]}" target="_blank" rel="noreferrer">ISSUE #{n} ↗</a><h2>{esc(r["title"])}</h2></div><span class="badge {r["status"]}">{LABELS[r["status"]]}</span></div><div class="source-links">GitHub 状态：开放 · <a href="{r["url"]}" target="_blank" rel="noreferrer">现时规格与评论</a>')
        if r['comments']:
            parts.append(f' · <a href="{r["comments"][-1]}" target="_blank" rel="noreferrer">快照时最新评论</a>')
        parts.append('</div><div class="results"><section><h3>已处理 / 已有事实</h3>'+bullets(r['solved'])+'</section><section><h3>仍需继续</h3>'+bullets(r['remaining'])+'</section></div><div class="diagram-layout"><section><h3>业务流程图</h3><div class="flow-scroll" tabindex="0" aria-label="可横向滚动的流程图">'+flow_svg(r)+'</div></section><section><h3>交互效果示意</h3><p class="muted"><small>步骤示意，非运行截图；用于核对动作与结果。实际实现状态以上方为准。</small></p>')
        parts.append(f'<div class="sim" data-number="{n}"><div class="sim-bar">瑞航 CRM · 操作与反馈</div><div class="sim-content"><p class="sim-title"></p><div class="sim-label">用户操作</div><div class="sim-action"></div><div class="sim-label">预期反馈 / 去向</div><div class="sim-result"></div></div><div class="sim-controls"><button data-step="-1" aria-label="上一交互步骤">← 上一步</button><span class="sim-count"></span><button data-step="1" aria-label="下一交互步骤">下一步 →</button></div></div></section></div>')
        images=[p for p in r['evidence'] if Path(p).suffix.lower() in ['.png','.jpg','.jpeg']]
        parts.append('<details open><summary>实际运行画面与证据</summary>')
        if images:
            parts.append('<p class="muted"><small>历史归档的实际画面；点击查看原图。母票引用子票截图仅证明对应子流程。</small></p><div class="image-grid">')
            for p in images:
                parts.append(f'<figure><a href="{repo_link(p)}" target="_blank" rel="noreferrer"><img loading="lazy" src="{repo_link(p)}" alt="#{n} 运行证据：{esc(Path(p).name)}"></a><figcaption>{esc(Path(p).name)}</figcaption></figure>')
            parts.append('</div>')
        else:
            parts.append('<p class="notice">本项未附可用的独立运行截图。上方仅为交互示意，不据此宣称视觉验收通过。</p>')
        parts.append('<div class="links">'+''.join(f'<a href="{repo_link(p)}" target="_blank" rel="noreferrer">{esc(Path(p).name)}</a>' for p in r['evidence'] if p not in images)+'</div></details>')
        parts.append(f'<div class="notes"><label for="note-{n}">你对 #{n} 的意见</label><textarea id="note-{n}" data-note="{n}" placeholder="记录逻辑不通、缺少步骤或希望调整的交互……"></textarea></div></article>')
    parts.append('<footer><p id="note-status">意见仅保存在当前浏览器。可导出 JSON 交回审阅，不会自动发送或修改业务数据。</p><p>非权威源 · 本报告是开发审阅快照。最终规格以开放 Issue、CONTEXT、ADR、DATABASE 和页面蓝本为准。继续实施后应重新生成本报告。</p></footer></main></div><script id="review-data" type="application/json">'+json.dumps(rows,ensure_ascii=False).replace('<','\\u003c')+'</script><script>'+JS+'</script></body></html>')
    (HERE/'index.html').write_text(''.join(parts),encoding='utf-8')
    markdown=[f'# 瑞航 CRM 逐 Issue 审阅\n\n> 非权威源 · {stamp} 的开发状态快照。\n\n[打开可交互报告](./index.html)：完整业务流程、每个 Issue 流程图/异常返回、交互示意、实际截图与可导出的审阅意见。\n\n当前 {len(rows)} 个开放 Issue；本地完成 {counts["local-done"]}，部分完成 {counts["partial"]}，实施中 {counts["in-progress"]}，已定稿待开发 {counts["planned"]}，待裁定 {counts["decision"]}。本地完成不代表远端交付或生产上线。\n\n按当前本地远端引用比较：领先 {divergence[0]}，落后 {divergence[1]}。远端获取、冲突及开放 PR 核查见[分支整合记录](../local-branch-integration-2026-09-10.md)。快照 HEAD `{head}`。\n\n| Issue | 现状 | 已处理 | 剩余 |\n| --- | --- | --- | --- |']
    for r in rows:
        markdown.append(f'| [#{r["number"]} {r["title"]}]({r["url"]}) | {LABELS[r["status"]]} | '+ '<br>'.join(r['solved']).replace('|','／')+' | '+'<br>'.join(r['remaining']).replace('|','／')+' |')
    markdown.append('\n## 完整业务方向\n\n模块数据归属见 [ARCHITECTURE · 逻辑数据归属](../../rewrite/ARCHITECTURE.md#data-ownership)。本报告用可点击总图显示跨模块依赖及当前实现状态，不替代权威源。\n\n## 更新方式\n\n维护同目录 `rows-*.json` 的事实判断；以新抓取的 `gh issue list --state open --json number,title,body,comments,labels,url,updatedAt` 结果调用 `build_report.py --issues <快照路径>`。生成器检查 Issue 全覆盖、唯一编号、异常回路索引与证据真实路径，不把源码检查当作业务验收。\n')
    (HERE/'README.md').write_text('\n'.join(markdown),encoding='utf-8')
    print(json.dumps({'issues':len(rows),'counts':counts,'htmlBytes':(HERE/'index.html').stat().st_size},ensure_ascii=False))


if __name__=='__main__':
    main()
