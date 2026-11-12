import { z } from 'zod';
import { createCapacityError, getCapacitySettings, updateDepartmentCapacity } from '../services/capacityService.js';
import { recordActivityEvent } from '../services/activityEventService.js';

const departmentSchema = z.string().trim().min(1).max(100);
const updateSchema = z.object({
  maxSimultaneousAbsent: z.number().int().min(0),
}).strict();

export const getCapacityController = async (_req, res, next) => {
  try {
    return res.status(200).json(await getCapacitySettings());
  } catch (error) {
    return next(error);
  }
};

export const updateCapacityController = async (req, res, next) => {
  const department = departmentSchema.safeParse(req.params.department);
  const body = updateSchema.safeParse(req.body);
  if (!department.success || !body.success) return next(createCapacityError(400, 'Invalid department or capacity value'));

  try {
    const capacity = await updateDepartmentCapacity({
      department: department.data,
      maxSimultaneousAbsent: body.data.maxSimultaneousAbsent,
      updatedBy: req.user.id,
    });
    await recordActivityEvent({
      eventType: 'department_capacity_updated',
      actorUserId: req.user.id,
      department: capacity.department,
    });
    return res.status(200).json({ capacity });
  } catch (error) {
    return next(error);
  }
};
