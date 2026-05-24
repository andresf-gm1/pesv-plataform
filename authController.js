const jwt = require("jsonwebtoken");
const catchAsync = require("../utils/catchAsync");
const { hashPassword, verifyPassword } = require("../utils/cryptoUtils");
const { sanitizeUser } = require("../server");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || "flee-command-secret-2026";

exports.login = catchAsync(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findFirst({
        where: {
            email: String(email || "").toLowerCase(),
            active: true
        }
    });

    if (!user || !verifyPassword(password || "", user)) {
        return res.status(401).json({ success: false, message: "Correo o clave incorrectos" });
    }

    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    const safeUser = sanitizeUser(user);
    const token = jwt.sign({ user: safeUser }, JWT_SECRET, { expiresIn: "24h" });

    res.json({ success: true, token, user: safeUser, company });
});

exports.register = catchAsync(async (req, res) => {
    const { companyName, nit, city, name, email, password, phone } = req.body;
    const cleanEmail = String(email || "").trim().toLowerCase();
    
    const existingUser = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (existingUser) {
        return res.status(409).json({ success: false, message: "Ya existe un usuario con ese correo" });
    }

    const passwordHash = hashPassword(password);
    
    const newCompany = await prisma.company.create({
        data: {
        name: String(companyName).trim(),
        nit: String(nit || "").trim(),
        city: String(city || "Colombia").trim(),
        plan: "Demo gratuita",
        billingStatus: "trial",
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        brandPhrase: "GPS + PESV inteligente",
        createdAt: new Date().toISOString()
        }
    });
    
    const newUser = await prisma.user.create({
        data: {
        companyId: newCompany.id,
        name: String(name).trim(),
        email: cleanEmail,
        phone: String(phone || "").trim(),
        role: "admin",
        passwordHash: passwordHash.hash,
        salt: passwordHash.salt,
        active: true,
        createdAt: new Date().toISOString()
        }
    });

    const safeUser = sanitizeUser(newUser);
    const token = jwt.sign({ user: safeUser }, JWT_SECRET, { expiresIn: "24h" });

    res.status(201).json({ success: true, token, user: safeUser, company: newCompany });
});