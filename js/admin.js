// تحكم في التابات + فتح تبويب "الأصناف" افتراضيًا
const $ = (sel, ctx=document)=>ctx.querySelector(sel);
const $$= (sel, ctx=document)=>Array.from(ctx.querySelectorAll(sel));

const btns = $$('.tab-btn');
const tabs = {
  requests: $('#tab-requests'),
  links:    $('#tab-links'),
  foods:    $('#tab-foods'),
};

function activate(tabName, pushHash=true){
  if(!tabs[tabName]) tabName='foods';
  btns.forEach(b=> b.classList.toggle('active', b.dataset.tab===tabName));
  Object.entries(tabs).forEach(([k,el])=> el.classList.toggle('active', k===tabName));
  if(pushHash) history.replaceState(null,'',`#${tabName}`);
}

function getInitialTab(){
  const q = new URLSearchParams(location.search);
  const t1 = (q.get('tab')||'').toLowerCase();
  if(t1 && tabs[t1]) return t1;
  const t2 = (location.hash.replace('#','')||'').toLowerCase();
  if(t2 && tabs[t2]) return t2;
  return 'foods';
}

btns.forEach(b=> b.addEventListener('click', ()=> activate(b.dataset.tab)));
document.addEventListener('DOMContentLoaded', ()=> activate(getInitialTab(), false));
window.addEventListener('hashchange', ()=> {
  const h=(location.hash.replace('#','')||'').toLowerCase();
  if(h && tabs[h]) activate(h,false);
});
