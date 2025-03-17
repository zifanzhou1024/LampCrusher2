
import { Vector2, Vector3, Vector4, Matrix4, Euler, Quaternion, Box3 } from 'three';
import {updateUI, spawnScorePopup}  from "./ui";

const kGravity = 9.8;

const getOBB = ( object, collisionScale = 1 ) =>
{
    const aabb = object.aabb;
    // Get the AABB center in local space...
    let center = new Vector3();
    aabb.getCenter(center);
    // ...and transform it into world space.
    center.applyMatrix4(object.transform);

    // Get the local size from the AABB.
    let size = new Vector3();
    aabb.getSize(size);

    // Extract the scale factors from the transform matrix.
    const m = object.transform;
    const scaleX = new Vector3(m.elements[0], m.elements[1], m.elements[2]).length();
    const scaleY = new Vector3(m.elements[4], m.elements[5], m.elements[6]).length();
    const scaleZ = new Vector3(m.elements[8], m.elements[9], m.elements[10]).length();

    // Compute the world half-sizes.
    const halfSizes = new Vector3(
        (size.x * scaleX) * 0.5 * collisionScale,
        (size.y * scaleY) * 0.5 * collisionScale,
        (size.z * scaleZ) * 0.5 * collisionScale,
    );

    // Get the axes from the transform (rotation component).
    const axes = [
        new Vector3(m.elements[0], m.elements[1], m.elements[2]).normalize(),
        new Vector3(m.elements[4], m.elements[5], m.elements[6]).normalize(),
        new Vector3(m.elements[8], m.elements[9], m.elements[10]).normalize()
    ];

    return { center, axes, halfSizes };
}

const halfProjection = ( obb, axis ) =>
{
  return obb.halfSizes.x * Math.abs(axis.dot(obb.axes[0])) +
         obb.halfSizes.y * Math.abs(axis.dot(obb.axes[1])) +
         obb.halfSizes.z * Math.abs(axis.dot(obb.axes[2]));
}

const obbIntersect = ( obb1, obb2 ) =>
{
  let axes = [];
  axes.push(
    obb1.axes[0], obb1.axes[1], obb1.axes[2],
    obb2.axes[0], obb2.axes[1], obb2.axes[2]
  );
  for ( let i = 0; i < 3; i++ )
  {
    for ( let j = 0; j < 3; j++ )
    {
      let axis = new Vector3().crossVectors( obb1.axes[i], obb2.axes[j] );
      if ( axis.lengthSq() > 1e-6 )
      {
        axis.normalize();
        axes.push( axis );
      }
    }
  }
  let tVec = new Vector3().subVectors( obb2.center, obb1.center );
  for ( let i = 0; i < axes.length; i++ )
  {
    let axis = axes[i];
    let r1 = halfProjection( obb1, axis );
    let r2 = halfProjection( obb2, axis );
    let t = Math.abs( tVec.dot( axis ) );
    if ( t > r1 + r2 )
    {
      return false;
    }
  }
  return true;
}

const computeOBBCorners = ( obb ) =>
{
  const { center, axes, halfSizes } = obb;
  const corners = [];
  for ( let dx of [-1, 1] )
  {
    for ( let dy of [-1, 1] )
    {
      for ( let dz of [-1, 1] )
      {
        let corner = new Vector3().copy( center );
        corner.add( new Vector3().copy( axes[0] ).multiplyScalar( dx * halfSizes.x ) );
        corner.add( new Vector3().copy( axes[1] ).multiplyScalar( dy * halfSizes.y ) );
        corner.add( new Vector3().copy( axes[2] ).multiplyScalar( dz * halfSizes.z ) );
        corners.push( corner );
      }
    }
  }
  return corners;
}

const getXZBounds = ( obb ) =>
{
  const corners = computeOBBCorners( obb );
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for ( let corner of corners )
  {
    minX = Math.min( minX, corner.x );
    maxX = Math.max( maxX, corner.x );
    minZ = Math.min( minZ, corner.z );
    maxZ = Math.max( maxZ, corner.z );
  }
  return { minX, maxX, minZ, maxZ };
}

const resolveCollisionMTV = ( lampOBB, letterOBB ) =>
{
  // Compute the XZ bounds for each OBB.
  const lampBounds = getXZBounds(lampOBB);
  const letterBounds = getXZBounds(letterOBB);

  // Compute the centers.
  const lampCenterX   = ( lampBounds.minX + lampBounds.maxX ) / 2;
  const lampCenterZ   = ( lampBounds.minZ + lampBounds.maxZ ) / 2;
  const letterCenterX = ( letterBounds.minX + letterBounds.maxX ) / 2;
  const letterCenterZ = ( letterBounds.minZ + letterBounds.maxZ ) / 2;

  // Compute overlap along X and Z.
  const overlapX = Math.min( lampBounds.maxX, letterBounds.maxX ) - Math.max( lampBounds.minX, letterBounds.minX );
  const overlapZ = Math.min( lampBounds.maxZ, letterBounds.maxZ ) - Math.max( lampBounds.minZ, letterBounds.minZ );

  // Choose the axis with the least penetration.
  if ( overlapX < overlapZ )
  {
    // If lamp's center is to the left of letter's center, push left; otherwise push right.
    const pushX = lampCenterX < letterCenterX ? -overlapX : overlapX;
    return new Vector3( pushX, 0, 0 );
  }
  else
  {
    // For Z axis.
    const pushZ = lampCenterZ < letterCenterZ ? -overlapZ : overlapZ;
    return new Vector3( 0, 0, pushZ );
  }
}

export class PhysicsEngine
{
  constructor(  )
  {
    this.ground_friction_constant = 0.99;
    this.time                     = 0.0;
  }

  fixed_update( scene, time )
  {
    const kTimestep = 0.002;

    while ( this.time < time )
    {
      scene.actors.forEach( 
        ( actor ) =>
        {
          if ( actor.get_position().y < 0.01 )
          {
            // Tangential velocity
            const friction_force = actor.get_velocity();
            friction_force.y     = 0.0;
            friction_force.normalize();

            friction_force.multiplyScalar( -this.ground_friction_constant * actor.mass * kGravity );
            actor.add_force( friction_force );

            actor.velocity.y     = 0.0;
          }
          else
          {
            // Otherwise gravity just gets cancelled out by the normal force if you're grounded
            actor.add_force( new Vector3( 0.0, -kGravity, 0.0 ) );
          }
        }
      );

      // Resolve soft-body collisions with lamp
      const rigid_bodies = new Map( [...scene.actors].filter( ( [_, actor] ) => actor.mass && ( !actor.spring_ks || !actor.spring_kd ) ) );
      rigid_bodies.forEach(
        ( rigid_body ) =>
        {
          const rigid_body_obb = getOBB( rigid_body, 0.8 );
          scene.actors.forEach(
            ( soft_body ) =>
            {
              if ( rigid_body.id === soft_body.id )
              {
                return;
              }

              if ( soft_body.mass == 0.0 )
              {
                return;
              }

              if ( !soft_body.spring_ks || !soft_body.spring_kd )
              {
                return;
              }
              
              const soft_body_obb = getOBB( soft_body, 0.9 );

              const soft_body_aabb        = soft_body.aabb.clone().applyMatrix4( soft_body.transform );
              const soft_body_rest_height = soft_body.aabb.clone().getSize( new Vector3() ).y;
              const soft_body_height      = soft_body_aabb.getSize( new Vector3() ).y;
/*
              if ( !obbIntersect( soft_body_obb, rigid_body_obb ) )
              {
                if ( !soft_body.scale_velocity )
                {
                  soft_body.scale_velocity = new Vector3();
                }

                const spring_force = ( soft_body_rest_height - soft_body_height ) * soft_body.spring_ks - soft_body.spring_kd * soft_body.scale_velocity.y;
                soft_body.scale_velocity.y += spring_force * kTimestep;
                const old_scale = soft_body.get_scale();
                const new_scale = old_scale.clone().add( soft_body.scale_velocity.clone().multiplyScalar( kTimestep ) );
                new_scale.y = Math.max( 0.1, new_scale.y );
                soft_body.set_scale( new_scale );

                return;
              }
*/
              if (!obbIntersect(soft_body_obb, rigid_body_obb)) {
                // 如果之前没定义过 scale_velocity，就初始化一个
                if (!soft_body.scale_velocity) {
                    soft_body.scale_velocity = new Vector3();
                }

                // ──────────────────────────────────────────────────────────
                // 1) 这里先计算“想要回弹的目标高度(targetHeight)”
                //    如果 soft_body 是 Letter，则用它的 restHeight * currentRestFactor
                //    否则用它本身 aabb 的原始高度（和以前一样）
                // ──────────────────────────────────────────────────────────
                let targetHeight;
                if (soft_body.type === 'letter') {
                    // Letter 用“原始高度 * currentRestFactor”
                    targetHeight = soft_body.restHeight * soft_body.currentRestFactor;
                } else {
                    // 其它有弹簧属性的 Actor，仍然用自身 AABB 的高度
                    const soft_body_rest_height = soft_body.aabb.clone().getSize(new Vector3()).y;
                    targetHeight = soft_body_rest_height;
                }

                // 计算当前 soft_body 的实际世界高度
                const soft_body_aabb = soft_body.aabb.clone().applyMatrix4(soft_body.transform);
                const soft_body_height = soft_body_aabb.getSize(new Vector3()).y;

                // ──────────────────────────────────────────────────────────
                // 2) 用“(目标高度 - 当前高度) * kS - 阻尼项”算出弹簧力
                //    不再用死值，而是基于 targetHeight
                // ──────────────────────────────────────────────────────────
                const spring_force = (targetHeight - soft_body_height) * soft_body.spring_ks
                                  - soft_body.spring_kd * soft_body.scale_velocity.y;

                // 将该力转换成对 scale_velocity 的变化
                soft_body.scale_velocity.y += spring_force * kTimestep;

                // 更新实际缩放：old_scale + scale_velocity * dt
                const old_scale = soft_body.get_scale();
                const new_scale = old_scale.clone().add(soft_body.scale_velocity.clone().multiplyScalar(kTimestep));

                // 让 y 方向不要缩成负数，最少保持一些厚度
                new_scale.y = Math.max(0.1, new_scale.y);
                soft_body.set_scale(new_scale);

                // 记得返回，因为这个分支下不走后面的碰撞分支
                return;
              }

              const vertical_penetration = soft_body.get_position().y + soft_body_height - rigid_body.get_position().y;

              if ( rigid_body.is_grounded() && soft_body.is_grounded() )
              {
                // Both are on the ground. Compute the MTV on the XZ plane.
                const correction = resolveCollisionMTV( rigid_body_obb, soft_body_obb );
                // Update the lamp's position (create a new vector and call set_position).
                const newPos = rigid_body.get_position().clone().add( correction );
                rigid_body.set_position( newPos );
              }
              else if ( vertical_penetration > 0.0 && rigid_body.get_velocity().y < 0.3 && soft_body.is_grounded() )
              {
                if (soft_body.currentRestFactor <= 0.4) {
                  scene.health += 30;

                  scene.remove(soft_body);
                  if (window.spawnCrushParticles) {
                    window.spawnCrushParticles(scene, soft_body.get_position());
                  }
                  console.log("Letter removed! 20 Points");
                   spawnScorePopup(20);
                   scene.score += 20;
                   // updateUI(scene.health, scene.score, scene.time);
                  return;
                }   
                // 4. (Optional) Give the lamp a bit of upward force
                const stompImpulse = 1200.0 * (1 + soft_body.currentRestFactor) / 2; // tune as desired
                rigid_body.add_force(new Vector3(0, stompImpulse, 0));

                soft_body.currentRestFactor -= 0.33;
                scene.health += 15;
                spawnScorePopup(10);
                scene.score += 15;
                // updateUI(scene.health, scene.score, scene.time);
   
                console.log("Stomped letter! 10 Points; new restFactor =", soft_body.currentRestFactor);
                /*
                const new_soft_body_height = Math.max( soft_body_height - vertical_penetration, 0.1 );
                const new_scale_y = new_soft_body_height / soft_body_rest_height;
                const old_scale_y          = soft_body.get_scale().y;

                const spring_force         = ( soft_body_rest_height - new_soft_body_height ) * soft_body.spring_ks - soft_body.spring_kd * soft_body.scale_velocity.y;
                console.log( `Spring force: ${spring_force}` );
                soft_body.scale_velocity = new Vector3( 0.0, ( new_soft_body_height - soft_body_rest_height ) / kTimestep, 0.0  );
                soft_body.set_scale( new Vector3( 1.0, new_scale_y, 1.0 ) );
                rigid_body.add_force( new Vector3( 0.0, spring_force, 0.0 ) );

                console.log( `Landed on letter! ${new_scale_y}` );
                */
              }
            }
          )
        }
      )

      scene.actors.forEach( 
        ( actor ) =>
        {
          if ( actor.mass == 0.0 )
          {
            return;
          }

          // Velocity verlet integration
          const position     = actor.get_position();
          const velocity     = actor.get_velocity();
          const acceleration = actor.get_force().multiplyScalar( 1.0 / actor.mass );
          position.add( velocity.clone().multiplyScalar( kTimestep ).add( acceleration.clone().multiplyScalar( 0.5 * kTimestep * kTimestep ) ) );
          position.y = Math.max( position.y, 0.0 );
          actor.set_position( position );

          actor.velocity.add( acceleration.clone().add( acceleration ).multiplyScalar( 0.5 * kTimestep ) );
        }
      );

      // Reset all the forces
      scene.actors.forEach( 
        ( actor ) =>
        {
          actor.force = new Vector3( 0.0, 0.0, 0.0 );
        }
      );

      this.time += kTimestep * 3.0;
    }
  }
}
