/**
 * A software WebAuthn authenticator for tests: builds the registration and
 * sign-in responses a browser would send, signed with a real P-256 key, so the
 * passkey routes are verified end to end without a browser.
 */
import crypto from 'crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

function counterBytes(count) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(count);
  return buf;
}

export function createSoftAuthenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = crypto.randomBytes(16);
  let signCount = 0;
  let userHandle = null;

  const cosePublicKey = isoCBOR.encode(new Map([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
    [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]
  ]));

  function clientData(type, challenge, origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  return {
    credentialId: b64url(credentialId),

    /** Answer navigator.credentials.create() for the given options. */
    register(options, origin) {
      userHandle = options.user.id;
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        sha256(options.rp.id),
        Buffer.from([0x45]), // user present + user verified + attested credential data
        counterBytes(signCount),
        Buffer.alloc(16), // AAGUID
        idLength,
        credentialId,
        Buffer.from(cosePublicKey)
      ]);
      const attestationObject = isoCBOR.encode(new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)]
      ]));
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientData('webauthn.create', options.challenge, origin)),
          attestationObject: b64url(attestationObject),
          transports: ['internal']
        },
        clientExtensionResults: {}
      };
    },

    /** Answer navigator.credentials.get() for the given options. */
    authenticate(options, origin, rpId) {
      signCount += 1;
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), counterBytes(signCount)]);
      const clientDataJSON = clientData('webauthn.get', options.challenge, origin);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          authenticatorData: b64url(authData),
          clientDataJSON: b64url(clientDataJSON),
          signature: b64url(signature),
          userHandle
        },
        clientExtensionResults: {}
      };
    }
  };
}
