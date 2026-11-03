import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, { providers: [provideZonelessChangeDetection()] }).catch(() => {
  document.body.textContent = 'No se pudo iniciar NSM. Recargá la página para volver a intentar.';
});
