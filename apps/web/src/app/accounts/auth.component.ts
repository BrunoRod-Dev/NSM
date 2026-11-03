import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SessionService } from './session.service';
type Field = 'username'|'displayName'|'password'|'passwordConfirm';
@Component({selector:'nsm-auth',imports:[FormsModule],templateUrl:'./auth.component.html'})
export class AuthComponent {
 readonly session=inject(SessionService);
 readonly mode=signal<'login'|'register'>('login');
 readonly busy=signal(false);readonly error=signal('');readonly showPassword=signal(false);
 readonly errors=signal<Partial<Record<Field,string>>>({});
 username='';displayName='';password='';passwordConfirm='';
 select(mode:'login'|'register'){this.mode.set(mode);this.error.set('');this.errors.set({});this.password='';this.passwordConfirm='';this.showPassword.set(false);}
 validate(field:Field){
  let message='';const register=this.mode()==='register';
  if(field==='username') {if(!this.username.trim())message='Ingresá tu usuario.';else if(register&&!/^[a-zA-Z0-9_]{3,24}$/.test(this.username.trim()))message='Usá de 3 a 24 letras, números o guion bajo, sin espacios.';}
  if(field==='displayName'&&register&&(!this.displayName.trim()||this.displayName.trim().length>40))message='Ingresá un nombre de hasta 40 caracteres.';
  if(field==='password'){if(!this.password)message='Ingresá tu contraseña.';else if(register&&this.password.length<8)message='Usá al menos 8 caracteres; no hacen falta símbolos especiales.';else if(this.password.length>128)message='Usá hasta 128 caracteres.';}
  if(field==='passwordConfirm'&&register){if(!this.passwordConfirm)message='Repetí tu contraseña.';else if(this.passwordConfirm!==this.password)message='Las contraseñas no coinciden.';}
  this.errors.update(all=>({...all,[field]:message}));return !message;
 }
 async submit(){
  if(this.busy())return;
  this.error.set('');
  const fields:Field[]=this.mode()==='register'?['username','displayName','password','passwordConfirm']:['username','password'];
  const invalid=fields.filter(field=>!this.validate(field));
  if(invalid.length){document.getElementById(invalid[0])?.focus();return;}
  this.busy.set(true);
  try{await this.session.authenticate(this.mode(),{username:this.username.trim(),displayName:this.displayName.trim(),password:this.password,passwordConfirm:this.passwordConfirm});}
  catch(error){this.error.set(error instanceof Error?error.message:'No se pudo conectar.');}
  finally{this.busy.set(false);}
 }
}
