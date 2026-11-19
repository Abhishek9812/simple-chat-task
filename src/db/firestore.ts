import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

export interface FirestoreOptions {
  projectId: string;
  clientEmail?: string | undefined;
  privateKey?: string | undefined;
  emulatorHost?: string | undefined;
}

/**
 * Initialises the Firebase Admin SDK once and returns a Firestore instance.
 *
 * Credential resolution order:
 *  1. Firestore emulator (FIRESTORE_EMULATOR_HOST) - no credentials needed
 *  2. Inline service account (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)
 *  3. Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS, GCP metadata)
 */
export function createFirestore(options: FirestoreOptions): Firestore {
  const app: App = getApps()[0] ?? initializeApp(buildAppOptions(options));
  const firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}

function buildAppOptions({ projectId, clientEmail, privateKey, emulatorHost }: FirestoreOptions) {
  if (emulatorHost) {
    return { projectId };
  }
  if (clientEmail && privateKey) {
    return {
      projectId,
      credential: cert({
        projectId,
        clientEmail,
        // Env files usually store the key with literal "\n" sequences.
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    };
  }
  return { projectId, credential: applicationDefault() };
}
