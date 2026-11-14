import { maintenanceRouter } from './maintenance/router.ts';
import { avatarProfile } from '../profile/profile.ts';
import { iconNodes } from '../profile/iconNodes.ts';
import { palettes } from '../ui/palette.ts';
import { escapeMarkup } from '../shared/markup.ts';
export function profileAvatarRoutes() {
  const router = maintenanceRouter();
  router.get('/profile-avatar/:icon/:color.svg', (request, response) => {
    const profile = avatarProfile(request.path);
    if (!profile) {
      response.sendStatus(404);
      return;
    }
    const nodes = iconNodes(profile.icon)
      .map(
        ([tag, props]) =>
          `<${tag} ${Object.entries(props)
            .map(([key, value]) => `${key}="${escapeMarkup(String(value))}"`)
            .join(' ')}/>`,
      )
      .join('');
    const bg = palettes.light[`fill-${profile.color}-bg`],
      fg = palettes.light[`fill-${profile.color}-fg`];
    response
      .type('image/svg+xml')
      .set('Cache-Control', 'public, max-age=86400')
      .send(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${bg}"/><g transform="translate(4 4)" fill="none" stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${nodes}</g></svg>`,
      );
  });
  return router;
}
