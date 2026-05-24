const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const validate = require("../utils/validation");
const Joi = require("joi");

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
});

const registerSchema = Joi.object({
    companyName: Joi.string().required(),
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
});

router.post("/login", validate(loginSchema), authController.login);
router.post("/register", validate(registerSchema), authController.register);

module.exports = router;