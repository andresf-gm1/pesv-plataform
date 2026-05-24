const Joi = require('joi');

const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false, allowUnknown: true });
    if (error) {
        const message = error.details.map(i => i.message).join(", ");
        return res.status(400).json({ success: false, message: `Error de validación: ${message}` });
    }
    next();
};

module.exports = validate;