const crypto = require("crypto");

/**
 * Genera un hash PBKDF2 de una contraseña.
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto
        .pbkdf2Sync(password, salt, 100000, 64, "sha512")
        .toString("hex");

    return { hash, salt };
}

/**
 * Verifica si una contraseña coincide con el hash almacenado.
 */
function verifyPassword(password, user) {
    const candidate = hashPassword(password, user.salt);
    return crypto.timingSafeEqual(
        Buffer.from(candidate.hash, "hex"),
        Buffer.from(user.passwordHash, "hex")
    );
}

module.exports = {
    hashPassword,
    verifyPassword
};