function listUsers() {
  return [];
}

function createUser(userData) {
  return { id: 1, ...userData };
}

module.exports = { listUsers, createUser };
