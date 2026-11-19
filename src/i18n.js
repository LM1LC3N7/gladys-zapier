// -----------------------------------------------------------------------------
// Texts shown to the user (status, button, scene errors), English and French.
// None of them ever holds a hook URL, the inbound secret, a value sent or
// received, or what Zapier answered word for word.
// -----------------------------------------------------------------------------

const n = (value, lang) => value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
const list = (slots) => slots.join(', ');

const INBOUND = {
  ready: {
    en: 'From Zapier: ready, through the Gladys Plus URL shown in the "Gladys Plus webhooks" block.',
    fr: "Depuis Zapier : prêt, par l'URL Gladys Plus affichée dans le bloc « Webhooks Gladys Plus ».",
  },
  no_plus: {
    en: 'From Zapier: needs Gladys Plus (link it and paste the Open API key in the "Gladys Plus webhooks" block); sending to Zapier works without it.',
    fr: "Depuis Zapier : nécessite Gladys Plus (liez-le et collez la clé Open API dans le bloc « Webhooks Gladys Plus ») ; l'envoi vers Zapier marche sans.",
  },
  unknown: {
    en: 'From Zapier: the Gladys Plus state could not be read yet.',
    fr: "Depuis Zapier : l'état de Gladys Plus n'a pas encore pu être lu.",
  },
  locked: {
    en: 'From Zapier: the shared secret does not read (8 to 200 characters, no space or accent): every event received is refused.',
    fr: 'Depuis Zapier : le secret partagé est illisible (8 à 200 caractères, sans espace ni accent) : tout événement reçu est refusé.',
  },
};

export const T = {
  inbound: INBOUND,
  status: {
    config_unread: (seconds) => ({
      en: `The configuration could not be read from Gladys: new try in ${seconds} s.`,
      fr: `La configuration n'a pas pu être lue depuis Gladys : nouvel essai dans ${seconds} s.`,
    }),
    bad_hook: (slots) => ({
      en: `Catch Hook ${list(slots)}: not a Zapier Catch Hook URL (https://hooks.zapier.com/hooks/catch/…/…/): copy it again from the trigger of the Zap.`,
      fr: `Catch Hook ${list(slots)} : pas une URL Catch Hook de Zapier (https://hooks.zapier.com/hooks/catch/…/…/) : copiez-la à nouveau depuis le déclencheur du Zap.`,
    }),
    no_hook: {
      en: 'Paste the Catch Hook URL of a Zap (trigger "Webhooks by Zapier", event "Catch Hook") in the configuration.',
      fr: "Collez l'URL Catch Hook d'un Zap (déclencheur « Webhooks by Zapier », événement « Catch Hook ») dans la configuration.",
    },
    refused: (slots) => ({
      en: ` Catch Hook ${list(slots)}: Zapier knows no such hook (404/410: Zap deleted, or URL changed): no scene uses it any more. Paste the URL again, or send a test with the button.`,
      fr: ` Catch Hook ${list(slots)} : Zapier ne connaît pas ce hook (404/410 : Zap supprimé ou URL changée) : plus aucune scène ne l'utilise. Collez à nouveau l'URL, ou envoyez un test avec le bouton.`,
    }),
    paused: (minutes, why) => {
      const cause = {
        rate_limited: {
          en: 'Zapier asked to slow down (429)',
          fr: 'Zapier a demandé de ralentir (429)',
        },
        loop: {
          en: 'Probable loop (a Zap calling Gladys, a scene sending back to Zapier)',
          fr: 'Boucle probable (un Zap qui appelle Gladys, une scène qui renvoie vers Zapier)',
        },
      }[why] ?? { en: 'Zapier is failing (5xx)', fr: 'Zapier est en panne (5xx)' };
      const after =
        why === 'loop'
          ? {
              en: ' Fix the scene, then save the configuration to resume.',
              fr: ' Corrigez la scène, puis enregistrez la configuration pour reprendre.',
            }
          : { en: '', fr: '' };
      return {
        en: `${cause.en}: nothing is sent to Zapier for about ${minutes} min.${after.en}`,
        fr: `${cause.fr} : rien n'est envoyé à Zapier pendant environ ${minutes} min.${after.fr}`,
      };
    },
    ready: ({ slots, day, maxDay, month, maxMonth }) => ({
      en: `Ready to send to Catch Hook ${list(slots)}. Zap runs counted by this module: ${n(day, 'en')} of ${n(maxDay, 'en')} over 24 hours, ${n(month, 'en')} of ${n(maxMonth, 'en')} over 30 days.`,
      fr: `Prêt à envoyer vers le Catch Hook ${list(slots)}. Exécutions de Zap comptées par ce module : ${n(day, 'fr')} sur ${n(maxDay, 'fr')} sur 24 heures, ${n(month, 'fr')} sur ${n(maxMonth, 'fr')} sur 30 jours.`,
    }),
    hook_paused: (slot, minutes) => ({
      en: ` Catch Hook ${slot}: paused about ${minutes} min after several refusals (4xx) in a row; the test button may try it, saving the configuration lifts the pause.`,
      fr: ` Catch Hook ${slot} : en pause environ ${minutes} min après plusieurs refus (4xx) d'affilée ; le bouton de test peut l'essayer, enregistrer la configuration lève la pause.`,
    }),
    receive_only: {
      en: 'No Catch Hook URL: nothing is sent to Zapier.',
      fr: "Aucune URL Catch Hook : rien n'est envoyé à Zapier.",
    },
    data_unreadable: {
      en: '/data is unreadable: nothing is sent to Zapier (the Zap runs counted are unknown). Read again every 10 s.',
      fr: "/data est illisible : rien n'est envoyé à Zapier (les exécutions de Zap comptées sont inconnues). Relu toutes les 10 s.",
    },
    data_unwritable: {
      en: ' /data could not be written at the last save: a send is refused while its count cannot be kept.',
      fr: " /data n'a pas pu être écrit au dernier enregistrement : un envoi est refusé tant que son décompte ne peut pas être gardé.",
    },
  },

  prefix: {
    nothing: { en: 'Nothing sent to Zapier', fr: 'Rien envoyé à Zapier' },
    maybe: {
      en: 'Sent to Zapier without a clear answer (the Zap may have run; counted, not tried again)',
      fr: 'Envoyé à Zapier sans réponse claire (le Zap a pu s’exécuter ; compté, pas de nouvel essai)',
    },
  },

  // Why a send did not leave, or got no clear answer.
  reason: {
    config_unread: {
      en: 'the configuration is not read yet',
      fr: "la configuration n'est pas encore lue",
    },
    no_hook: {
      en: 'no Catch Hook URL for this Zap in the configuration',
      fr: 'pas d’URL Catch Hook pour ce Zap dans la configuration',
    },
    bad_hook: {
      en: 'the Catch Hook URL of this Zap does not read',
      fr: "l'URL Catch Hook de ce Zap est illisible",
    },
    bad_zap: { en: 'unknown Zap choice', fr: 'choix de Zap inconnu' },
    bad_event: {
      en: 'the event name must be 1 to 64 letters, digits, "_", "-" or "."',
      fr: "le nom d'événement doit faire 1 à 64 lettres, chiffres, « _ », « - » ou « . »",
    },
    too_long: {
      en: 'a value is longer than 1,000 characters',
      fr: 'une valeur dépasse 1 000 caractères',
    },
    bad_json: {
      en: 'the JSON field is not a JSON object',
      fr: "le champ JSON n'est pas un objet JSON",
    },
    json_too_large: {
      en: 'the JSON object is larger than 8 KB',
      fr: "l'objet JSON dépasse 8 Ko",
    },
    data_pending: { en: '/data is not read yet', fr: "/data n'est pas encore lu" },
    data_unreadable: {
      en: '/data is unreadable (the Zap runs counted are unknown)',
      fr: '/data est illisible (les exécutions de Zap comptées sont inconnues)',
    },
    data_unwritable: {
      en: 'the count could not be saved in /data',
      fr: "le décompte n'a pas pu être enregistré dans /data",
    },
    queue_full: {
      en: 'too many sends waiting for their turn',
      fr: 'trop d’envois attendent leur tour',
    },
    time: { en: 'no time left for the request', fr: 'plus le temps de faire la requête' },
    stopped: { en: 'the integration stopped', fr: "l'intégration s'est arrêtée" },
    paused_rate_limited: (m) => ({
      en: `paused after a 429 of Zapier (about ${m} min left)`,
      fr: `en pause après un 429 de Zapier (encore environ ${m} min)`,
    }),
    paused_server: (m) => ({
      en: `paused after a 5xx of Zapier (about ${m} min left)`,
      fr: `en pause après un 5xx de Zapier (encore environ ${m} min)`,
    }),
    paused_client: (m) => ({
      en: `this Catch Hook is paused after several refusals (4xx) in a row (about ${m} min left)`,
      fr: `ce Catch Hook est en pause après plusieurs refus (4xx) d'affilée (encore environ ${m} min)`,
    }),
    loop: {
      en: 'probable loop between a Zap and a scene: sends stopped for 30 min (save the configuration to resume)',
      fr: 'boucle probable entre un Zap et une scène : envois arrêtés 30 min (enregistrez la configuration pour reprendre)',
    },
    burst: {
      en: 'more than 10 sends in a minute',
      fr: 'plus de 10 envois en une minute',
    },
    cap_day: {
      en: 'the cap of Zap runs over 24 hours is reached',
      fr: "le plafond d'exécutions de Zap sur 24 heures est atteint",
    },
    cap_month: {
      en: 'the cap of Zap runs over 30 days is reached',
      fr: "le plafond d'exécutions de Zap sur 30 jours est atteint",
    },
    refused: {
      en: 'Zapier knew no such hook at the last send (404/410)',
      fr: 'Zapier ne connaissait pas ce hook au dernier envoi (404/410)',
    },
    gone: {
      en: 'Zapier knows no such hook (404/410: Zap deleted, or URL changed)',
      fr: 'Zapier ne connaît pas ce hook (404/410 : Zap supprimé ou URL changée)',
    },
    forbidden: {
      en: 'Zapier answered 401/403 (not taken as a refusal of the hook)',
      fr: 'Zapier a répondu 401/403 (pas pris pour un refus du hook)',
    },
    request_too_large: {
      en: 'Zapier refused the size of the request (413)',
      fr: 'Zapier a refusé la taille de la requête (413)',
    },
    invalid: { en: 'refused by Zapier (400)', fr: 'refusé par Zapier (400)' },
    rate_limited: {
      en: 'Zapier asked to slow down (429)',
      fr: 'Zapier a demandé de ralentir (429)',
    },
    server: { en: 'Zapier failed (5xx)', fr: 'Zapier en panne (5xx)' },
    timeout: { en: 'Zapier did not answer in time', fr: "Zapier n'a pas répondu à temps" },
    network: { en: 'network error', fr: 'erreur réseau' },
    redirect: { en: 'unexpected redirect', fr: 'redirection inattendue' },
    http: { en: 'unexpected answer', fr: 'réponse inattendue' },
  },

  test: {
    ok: (slot, runs) => ({
      en: `Zapier accepted the test event on Catch Hook ${slot} (${runs} Zap run${runs > 1 ? 's' : ''} counted). Open the Zap to see it.`,
      fr: `Zapier a accepté l'événement de test sur le Catch Hook ${slot} (${runs} exécution${runs > 1 ? 's' : ''} de Zap comptée${runs > 1 ? 's' : ''}). Ouvrez le Zap pour le voir.`,
    }),
  },
};

/** An Error for a scene log: English first, then French. */
export function sceneError(message) {
  return new Error(`${message.en} | ${message.fr}`);
}

/** A reason alone, as a two-language message. */
export function reasonMessage(code, prefix = T.prefix.nothing, minutes = 1) {
  const entry = T.reason[code] ?? T.reason.http;
  const r = typeof entry === 'function' ? entry(minutes) : entry;
  return { en: `${prefix.en}: ${r.en}.`, fr: `${prefix.fr} : ${r.fr}.` };
}

/** Two messages joined by a space. */
export const join = (a, b) => ({ en: `${a.en} ${b.en}`, fr: `${a.fr} ${b.fr}` });
