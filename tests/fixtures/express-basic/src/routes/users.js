const express = require('express');
const { listUsers, createUser } = require('../services/user_service');

const router = express.Router();

router.get('/', (req, res) => {
  const users = listUsers();
  res.json(users);
});

router.post('/', (req, res) => {
  const user = createUser(req.body);
  res.status(201).json(user);
});

module.exports = router;
