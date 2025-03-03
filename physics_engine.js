import { Vector2, Vector3, Vector4, Matrix4, Euler, Quaternion, Box3 } from 'three';

const kGravity = 9.8;

export class PhysicsEngine
{
  constructor(  )
  {
    this.ground_friction_constant = 0.1;
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

