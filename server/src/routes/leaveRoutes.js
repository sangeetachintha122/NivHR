import { Router } from 'express';
import {
  applyForLeaveController,
  decideLeaveController,
  getMyLeavesController,
  listAllLeavesController,
} from '../controllers/leaveController.js';
import authenticate from '../middleware/authenticate.js';
import requireRole from '../middleware/requireRole.js';

const router = Router();

router.use(authenticate);
router.post('/', requireRole('employee'), applyForLeaveController);
router.get('/mine', requireRole('employee'), getMyLeavesController);
router.get('/', requireRole('hr'), listAllLeavesController);
router.patch('/:id/decision', requireRole('hr'), decideLeaveController);

export default router;
