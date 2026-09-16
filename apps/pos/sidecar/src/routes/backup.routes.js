const express = require('express');
const { saveDb, createBackup, listBackups, restoreBackup, exportBackup } = require('../db');

const router = express.Router();

router.get('/api/backup/list', (req, res) => {
  res.json(listBackups());
});

router.post('/api/backup/now', (req, res) => {
  try {
    saveDb();
    createBackup();
    res.json({ message: 'Backup created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/backup/restore', (req, res) => {
  const { filename } = req.body;
  try {
    restoreBackup(filename);
    res.json({ message: 'Database restored successfully' });
  } catch (err) {
    const status = err.message === 'Backup not found' ? 404 : err.message === 'Invalid filename' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/api/backup/export', (req, res) => {
  const { filename, destPath } = req.body;
  try {
    exportBackup(filename, destPath);
    res.json({ message: 'Exported successfully' });
  } catch (err) {
    const status =
      err.message === 'Backup not found' ? 404 : err.message === 'Invalid filename' || err.message === 'Invalid destination path' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
