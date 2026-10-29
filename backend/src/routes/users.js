import express from 'express';
import { list, detail, create, deactivate, activate } from '../controllers/userController.js';
import { coworkers } from '../controllers/workController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);
router.get('/coworkers', coworkers);
router.get('/', list);
router.post('/', create);
router.get('/:id', detail);
router.post('/:id/deactivate', deactivate);
router.post('/:id/activate', activate);

export default router;
