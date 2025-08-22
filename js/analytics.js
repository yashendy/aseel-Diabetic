:root{
  --bg:#f6f9fc; --card:#fff; --muted:#6b7280; --text:#111827;
  --primary:#4F46E5; --line:#e5e7eb; --green:#16a34a; --red:#ef4444; --blue:#3b82f6;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:"Segoe UI",Tahoma,Arial,sans-serif}
.container{max-width:1200px;margin:auto;padding:16px}

.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:12px 0;box-shadow:0 6px 16px rgba(0,0,0,.04)}
.top .head-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start}
.muted{color:var(--muted)} .tiny{font-size:12px}

.controls .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.btn{background:var(--primary);color:#fff;border:none;border-radius:10px;padding:8px 14px;cursor:pointer}
.btn.secondary{background:#e5e7eb;color:#111}
.btn.ghost{background:transparent;border:1px solid var(--line);color:#111}
.btn:hover{opacity:.95}
select,input,textarea{border:1px solid var(--line);border-radius:10px;padding:8px;background:#fff}

.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 10px;cursor:pointer}
.chip.active,.chip:hover{border-color:var(--primary);color:var(--primary)}

.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:10px}
.stat{border:1px dashed var(--line);border-radius:12px;padding:10px;background:#fafafa}
.stat .label{font-size:12px;color:var(--muted)}
.stat .value{font-size:20px;font-weight:700}
.stat .value.red{color:var(--red)} .stat .value.blue{color:var(--blue)}

.ai{position:fixed;bottom:16px;left:16px;width:360px;max-width:92vw;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.14);display:flex;flex-direction:column}
.ai.hidden{display:none}
.ai-head{display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--line)}
.ai-body{max-height:46vh;overflow:auto}
.ai-messages{padding:10px;display:flex;flex-direction:column;gap:8px}
.msg{padding:8px 10px;border-radius:10px;border:1px solid var(--line)}
.msg.user{align-self:flex-end;background:#EEF2FF;border-color:#C7D2FE}
.msg.assistant{background:#F9FAFB}
.msg.sys{background:#FEF3C7;border-color:#FDE68A}
.ai-input{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line)}
.icon{background:#f3f4f6;border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer}
