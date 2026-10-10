/* Official +888 numbers (internal IDs only; approval by server-side owner). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const settings = $('settings-modal');
  if (!settings || !$('official-digits')) return;
  const digits = $('official-digits');
  const btn = $('official-request-button');
  const status = $('official-status');
  let current = null;
  let expanded = false;
  let busy = false;
  const labelMap = {pending:'Ожидает решения владельца @Z1pperJ',approved:'Одобрено — возьми код из чата поддержки',active:'Номер привязан',rejected:'Заявка отклонена',cancelled:'Заявка отменена'};
  const message = (text,failed=false)=>{status.textContent=text;status.style.color=failed?'#ffa8a8':'';};
  // On Electron the page is loaded via file://; location.origin is not a server URL.
  // On the website/Android use the live origin so self-hosted deployments still work.
  const API_BASE_URL = (location.protocol === 'https:' || location.protocol === 'http:')
    ? location.origin
    : 'https://my-chat-ucw4.onrender.com';
  async function api(path,method='GET',body=null) {
    const token=localStorage.getItem('burmal.token');
    if(!token)throw new Error('Сначала войди в аккаунт.');
    const result=await window.burmalDesktop.apiRequest({
      baseUrl:API_BASE_URL,path,method,body,token
    });
    if(!result.ok)throw new Error(result.data?.error||`Ошибка сервера (${result.status})`);
    return result.data||{};
  }
  function render() {
    const number = current?.officialNumber||'';
    const request=current?.request;
    const waiting=request && ['pending','approved','active'].includes(request.status);
    $('official-my-number').classList.toggle('hidden',!number);
    $('official-my-number').textContent=number ? 'Твой официальный номер: '+number : '';
    $('official-open-purchase').classList.toggle('hidden',Boolean(number||waiting));
    $('official-request-panel').classList.toggle('hidden', Boolean(number||waiting||!expanded));
    $('official-confirm-panel').classList.toggle('hidden',!(!number&&request?.status==='approved'));
    $('official-cancel').classList.toggle('hidden',request?.status!=='pending');
    $('official-confirm-number').value=request?.number||'';
    message(number?'✓ Официальный номер активирован и виден всем пользователям.':
      request?`${request.number}: ${labelMap[request.status]||request.status}.`:'Нажми «Купить официальный номер», выбери 8 цифр и отправь запрос владельцу @Z1pperJ. Оплата и условия согласуются напрямую с владельцем, автоматического списания нет.');
    btn.disabled=!/^\d{8}$/.test(digits.value)||Boolean(number||waiting);
  }
  async function refresh() {
    if(!localStorage.getItem('burmal.token'))return;
    try { current=await api('/api/official-number/me');render(); }
    catch(e){message(e.message,true);}
  }
  $('official-open-purchase').addEventListener('click',()=>{expanded=!expanded;render();});
  digits.addEventListener('input',()=>{ digits.value=digits.value.replace(/\D/g,'').slice(0,8);render(); });
  async function act(button,task) {
    if(busy)return;busy=true;button.disabled=true;
    let failure='';
    try {await task();await refresh();}catch(e){failure=e.message||'Ошибка запроса';}
    finally{busy=false;button.disabled=false;render();if(failure)message(failure,true);}
  }
  btn.addEventListener('click',()=>act(btn,async()=>{
    if(!/^\d{8}$/.test(digits.value))throw new Error('Введи ровно 8 цифр.');
    await api('/api/official-number/request','POST',{digits:digits.value});
  }));
  $('official-cancel').addEventListener('click',()=>act($('official-cancel'),async()=>{
    await api('/api/official-number/cancel','POST',{});
  }));
  $('official-confirm').addEventListener('click',()=>act($('official-confirm'),async()=>{
    const code=$('official-code').value.trim();
    if(!/^\d{8}$/.test(code))throw new Error('Введи 8-значный код из чата поддержки.');
    await api('/api/official-number/confirm','POST',{number:$('official-confirm-number').value,code});
    $('official-code').value='';
    window.dispatchEvent(new Event('burmal:official-number-linked'));
  }));
  $('official-refresh').addEventListener('click',refresh);
  let adminBusy=false;
  const adminPanel=$('official-admin-results');
  const adminStatus=$('admin-status');
  async function loadAdmin() {
    if(adminBusy || $('admin-modal')?.classList.contains('hidden')|| $('admin-manager')?.classList.contains('hidden'))return;
    adminBusy=true;adminPanel.textContent='Загружаем заявки…';
    try {
      const data=await api('/api/admin/official-numbers');
      adminPanel.replaceChildren();
      if(!data.requests?.length){adminPanel.textContent='Пока нет заявок.';return;}
      for(const r of data.requests){
        const card=document.createElement('div');card.className='official-admin-request';
        const title=document.createElement('strong');title.textContent=r.number+' — @'+r.username;
        const details=document.createElement('p');details.textContent=(r.displayName||'')+' · '+(labelMap[r.status]||r.status);
        card.append(title,details);
        if(['pending','approved'].includes(r.status)){
          const actions=document.createElement('div');actions.className='official-admin-actions';
          const make=(name,endpoint)=>{
            const b=document.createElement('button');b.type='button';b.className='secondary-button';b.textContent=name;
            b.onclick=async()=>{b.disabled=true;try{await api(`/api/admin/official-numbers/${encodeURIComponent(r.id)}/${endpoint}`,'POST',{});await loadAdminForce();}
              catch(e){alert(e.message);b.disabled=false;}};
            actions.appendChild(b);
          };
          if(r.status==='pending'){make('Одобрить','approve');make('Отклонить','reject');}
          else make('Отправить новый код','resend');
          card.appendChild(actions);
        }
        adminPanel.appendChild(card);
      }
    }catch(e){adminPanel.textContent=e.message;}
    finally{adminBusy=false;}
  }
  async function loadAdminForce(){adminBusy=false;await loadAdmin();}
  $('official-admin-refresh')?.addEventListener('click',loadAdmin);
  const observer = new MutationObserver(()=>{
    if(!settings.classList.contains('hidden'))refresh();
    if(!$('admin-modal').classList.contains('hidden') && !$('admin-manager').classList.contains('hidden'))loadAdmin();
  });
  observer.observe(settings,{attributes:true,attributeFilter:['class']});
  observer.observe($('admin-modal'),{attributes:true,attributeFilter:['class']});
  observer.observe($('admin-manager'),{attributes:true,attributeFilter:['class']});
  setInterval(()=>{if(!settings.classList.contains('hidden'))refresh();},20000);
  render();
})();
