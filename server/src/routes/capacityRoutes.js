import { Router } from 'express';
import authenticate from '../middleware/authenticate.js';
import requireRole from '../middleware/requireRole.js';
import { getCapacityController, updateCapacityController } from '../controllers/capacityController.js';

const router = Router();

router.use(authenticate, requireRole('hr'));
router.get('/', getCapacityController);
router.put('/:department', updateCapacityController);

export default router;
