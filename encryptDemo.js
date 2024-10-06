require('dotenv').config()
const crypto = require('crypto')
const ENCRYPTION_KEY = Buffer.from(process.env.ENV_SECRET, 'hex');

function encrypt(text, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + encrypted + ':' + tag.toString('hex');
}

function decrypt(text, key) {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encrypted = Buffer.from(parts.shift(), 'hex');
    const tag = Buffer.from(parts.shift(), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function genEncChatKey() {
  const chatKey = crypto.randomBytes(32); // 256-bit chat key
  const encryptedChatKey = encrypt(chatKey.toString('hex'), ENCRYPTION_KEY);
  return encryptedChatKey;
}

function encryptMessage(message, key) {
  const chatKey = Buffer.from(key, 'hex');
  return encrypt(message, chatKey);
}

function decryptMessage(encryptedMessage, key) {
  const chatKey = Buffer.from(key, 'hex');
  return decrypt(encryptedMessage, chatKey);
}

module.exports={encrypt,decrypt,genEncChatKey,ENCRYPTION_KEY,encryptMessage,decryptMessage}