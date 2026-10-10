/* BurmalpticajopaChat v8.4: shared web/Android/Electron theme preference. */
(() => {
  'use strict';
  const KEY='burmal.appearance.theme.v1';
  const themes=new Set(['blue','black','white']);
  function getStored(){try {return localStorage.getItem(KEY)} catch {return null}}
  function setStored(value){try {localStorage.setItem(KEY,value)} catch {}}
  const initial=themes.has(getStored())?getStored():'blue';
  const choices=[...document.querySelectorAll('[data-burmal-theme-option]')];
  const meta=document.querySelector('meta[name="theme-color"]');
  function apply(name){
    const v=themes.has(name)?name:'blue';
    document.documentElement.setAttribute('data-burmal-theme',v);
    setStored(v);
    if(meta) meta.content=v==='white'?'#edf4fb':v==='black'?'#08090d':'#07152d';
    choices.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.burmalThemeOption===v)));
  }
  for(const btn of choices) btn.addEventListener('click',()=>apply(btn.dataset.burmalThemeOption));
  apply(initial);
})();
