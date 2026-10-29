// 记账域权限中间件（契约 S8S9S10 §2 / S2 §2.3 + A8）
// 可见 = 本科室记账员 / 有效代录人 / role>=2；普通科员 4030（唯一例外本人 my-items）
import { fail } from './response.js';
import { getActiveDelegationFor } from '../services/permissionService.js';

// 当前用户在账目域的能力判定（带缓存）
export function accountingAbility(me) {
  if (!me) return { view: false, operate: false, confirm: false };
  const isBookkeeper = me.isBookkeeper === 1;
  const delegation = isBookkeeper ? null : getActiveDelegationFor(me.id);
  const isDelegate = !!delegation;
  return {
    view: me.role >= 2 || isBookkeeper || isDelegate,
    operate: isBookkeeper || isDelegate,
    confirm: me.role === 3 || me.role === 2
  };
}

// 账目可见
export function requireAccountingView(req, res, next) {
  const ab = accountingAbility(req.currentUser);
  req.accountingAbility = ab;
  if (!ab.view) return fail(res, 4030, '科员无账目访问权限');
  return next();
}

// 账目可操作（记账员/代录）
export function requireAccountingOperate(req, res, next) {
  const ab = accountingAbility(req.currentUser);
  req.accountingAbility = ab;
  if (!ab.operate) return fail(res, 4030, '仅记账员或有效代录人可操作账目');
  return next();
}

// 确认权（科长3/副科长2）
export function requireAccountingConfirm(req, res, next) {
  const ab = accountingAbility(req.currentUser);
  req.accountingAbility = ab;
  if (!ab.confirm) return fail(res, 4030, '仅科长或副科长可确认');
  return next();
}
