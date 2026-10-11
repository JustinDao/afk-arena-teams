import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { APP_ROUTES } from './app/app.routes';

bootstrapApplication(AppComponent, { providers: [provideRouter(APP_ROUTES)] }).catch((error: unknown) => {
  console.error('Unable to start AFK Arena Team Lineups.', error);
});
