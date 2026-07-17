"""
One-time script to generate VAPID keys for Web Push.
Run once on your server:  python generate_vapid.py
Then follow the printed instructions.
"""
import base64
import os

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

key = ec.generate_private_key(ec.SECP256R1())

pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.TraditionalOpenSSL,
    serialization.NoEncryption(),
)

pub_bytes = key.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint,
)
pub_b64 = base64.urlsafe_b64encode(pub_bytes).decode().rstrip("=")

pem_path = os.path.join(os.path.dirname(__file__), "vapid_private.pem")
with open(pem_path, "wb") as f:
    f.write(pem)

print("=" * 60)
print("VAPID keys generated.")
print(f"Private key saved to: {pem_path}")
print()
print("Add these lines to backend/.env:")
print(f"  VAPID_PRIVATE_KEY_PATH={pem_path}")
print(f"  VAPID_PUBLIC_KEY={pub_b64}")
print(f"  VAPID_EMAIL=admin@yourdomain.com")
print()
print("Add this line to frontend/.env.production:")
print(f"  VITE_VAPID_PUBLIC_KEY={pub_b64}")
print("=" * 60)
