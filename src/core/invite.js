import { G } from './state.js';

/* ---------- v12.48: the invitation e-mail ----------
   Before, an invited person only got the plain sign-in code mail – no word of who invites them, into which company, where to sign in or
   how long the code lasts. The edge function invite-notify now sends a real invitation (inviter, company, role, a button to the sign-in page
   with the e-mail filled in, the three sign-in steps, validity). The code is requested on the sign-in page, so the invitation itself does
   not run out. When the function is not available yet (not deployed, log table missing, mail service down) the old way still works:
   the sign-in code mail. Answers {ok, how:'invite'|'otp'} or {ok:false, code}. */
const FINAL = ['already_member', 'other_ws', 'too_soon', 'limit', 'no_invite', 'no_permission', 'email', 'login_required'];

async function sendInvite(email, opts={}){
  const lang = opts.lang || (G.LANG === 'de' ? 'de' : 'en');
  try{
    const {data, error} = await G.sb.functions.invoke('invite-notify', {body: Object.assign({email, lang}, opts.ws ? {ws: opts.ws} : {})});
    let code = data && data.error;
    if(error){ code = error.message || 'error'; try{ if(error.context && error.context.json){ const j = await error.context.json(); if(j && j.error) code = j.error; } }catch(e){} }
    if(!code && data && data.sent) return {ok:true, how:'invite'};
    if(FINAL.includes(code)) return {ok:false, code};
  }catch(e){}
  // fallback: the sign-in code mail (creates the login right away, the invitation in the workspace row places the person on first sign-in)
  const {error} = await G.sb.auth.signInWithOtp({email, options:{shouldCreateUser:true, emailRedirectTo: location.href.split('#')[0]}});
  return error ? {ok:false, code: error.message || 'error'} : {ok:true, how:'otp'};
}

// the toast text for a result
const inviteMsg = (r, email, t) => r.ok ? t(r.how === 'invite' ? 'inv_sent' : 'inv_sent_otp', {e: email})
  : ({already_member: t('inv_already_member', {e: email}), other_ws: t('inv_other_ws', {e: email}), too_soon: t('inv_too_soon'), limit: t('inv_limit'), no_permission: t('only_admin')}[r.code] || r.code);

export { sendInvite, inviteMsg };
