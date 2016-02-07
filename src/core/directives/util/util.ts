import { getInjectableName } from '../../di/provider';
import { isString, isType, getFuncName, global, noop } from '../../../facade/lang';
import { reflector } from '../../reflection/reflection';
import { DirectiveMetadata } from '../metadata_directives';
import { ListWrapper, StringMapWrapper } from '../../../facade/collections';
import { ChildrenChangeHook } from '../../linker/directive_lifecycle_interfaces';
import { QueryMetadata } from '../metadata_di';
import { DirectiveCtrl } from '../directive_provider';

/**
 * resolving DOM instances by provided @ContentChild(ren)/@ViewChild(ren)
 * - if querying for string, we handle it as a selector and return jqLite instances
 * - if querying for Type( directive | component ) we get proper selector and controller from
 * provided Type reference, query the DOM and return that controller instance if exists, otherwise null
 * @param element
 * @param ctrl
 * @param key
 * @param cssSelector
 * @param type
 * @param firstOnly
 * @returns {function(): void}
 * @private
 */
export function _resolveChildrenFactory(
  element: ng.IAugmentedJQuery,
  ctrl: any,
  key: string,
  cssSelector: string|Type,
  type: string,
  firstOnly: boolean = false
) {

  const { selector, childCtrlName } = _getSelectorAndCtrlName( cssSelector );

  return _childResolver;

  function _childResolver(): void {

    if ( firstOnly ) {

      ctrl[ key ] = null;
      const child = _getChildElements( element, selector, type, firstOnly );
      const childInstance = isString( cssSelector )
        ? child
        : getController( child, childCtrlName );
      ctrl[ key ] = childInstance;

    } else {

      ctrl[ key ] = [];
      const children = _getChildElements( element, selector, type );
      if ( isString( cssSelector ) ) {
        ctrl[ key ] = children;
        return;
      }
      for ( let i = 0; i < children.length; i++ ) {

        ctrl[ key ].push(
          getController( (children.eq( i ) as ng.IAugmentedJQuery ), childCtrlName )
        );
      }

    }

  }

}

export function _getChildElements(
  $element: ng.IAugmentedJQuery,
  selector: string,
  type: string,
  firstOnly: boolean = false
): ng.IAugmentedJQuery {

  let querySelector = '';

  if ( type === 'view' ) {
    // Note: we are guarding only for first nested child inside ng-transclude
    // this would be to complicated and DOM heavy to select only selectors outside ng-transclude
    // - it should be author responsibility to not include Component view directive within <ng-transclude> and querying for them
    querySelector = `:not(ng-transclude):not([ng-transclude]) > ${ selector }`;
  }
  if ( type === 'content' ) {
    querySelector = `ng-transclude ${ selector }, [ng-transclude] ${ selector }`;
  }
  const queryMethod = firstOnly
    ? 'querySelector'
    : 'querySelectorAll';

  return global.angular.element( $element[ 0 ][ queryMethod ]( querySelector ) );

}

export function getController( $element: ng.IAugmentedJQuery, ctrlName: string, inheritType?: string ) {

  if ( !$element ) {

    return null;

  }

  //If only parents then start at the parent element
  if (inheritType === '^^') {
    $element = $element.parent() as ng.IAugmentedJQuery;
    //Otherwise attempt getting the controller from elementControllers in case
    //the element is transcluded (and has no data) and to avoid .data if possible
  }
  const dataName = `$${ ctrlName }Controller`;

  //const value = inheritType ? $element.inheritedData(dataName) : $element.data(dataName);
  //return value;
  return $element.controller(ctrlName);

}

export function _getSelectorAndCtrlName( childSelector: string|Type ): {selector:string,childCtrlName:string} {

  const selector = _getSelector( childSelector );
  const childCtrlName = getInjectableName( childSelector );

  return { selector, childCtrlName };

}

export function _getSelector( selector: string|Type ): string {

  if ( isString( selector ) ) {
    return selector;
  }
  if ( isType( selector ) ) {

    const [annotation] = reflector.annotations( selector );

    if ( annotation instanceof DirectiveMetadata ) {
      return annotation.selector;
    }

  }

  throw new Error( `cannot query for non Directive/Component type ${ getFuncName( selector as any )}` );

}

/**
 * creates functions which will be called from parent component which is querying this component
 * - component which queries needs to be injected to child,
 * here child creates special callbacks by type of @Query which will be called from postLink and on scope destroy so
 * we clean up GC
 * @param ctrl
 * @param requiredCtrls
 * @returns {Object|Array|T|function()[]}
 * @private
 */
export function _getParentCheckNotifiers( ctrl: DirectiveCtrl, requiredCtrls: Object[] ): Function[] {

  const parentCheckedNotifiers = requiredCtrls.reduce(
    ( acc, requiredCtrl: DirectiveCtrl )=> {

      const Ctor = requiredCtrl.constructor;

      if ( !isType( Ctor ) ) {
        return acc;
      }
      const propMeta = reflector.propMetadata( Ctor );
      if ( !StringMapWrapper.size( propMeta ) ) {
        return acc;
      }

      const _parentCheckedNotifiers = [];
      StringMapWrapper.forEach( propMeta, ( propMetaPropArr: any[] )=> {

        propMetaPropArr
          .filter( ( propMetaInstance )=> {

            if ( !((propMetaInstance instanceof QueryMetadata ) && isType( propMetaInstance.selector )) ) {
              return false;
            }
            return ctrl instanceof propMetaInstance.selector;

          } )
          .forEach( ( propMetaInstance )=> {

            if ( !propMetaInstance.isViewQuery ) {

              _parentCheckedNotifiers.push(
                ()=>requiredCtrl._ngOnChildrenChanged(
                  ChildrenChangeHook.FromContent,
                  [ requiredCtrl.ngAfterContentChecked.bind( requiredCtrl ) ]
                )
              );

            }
            if ( propMetaInstance.isViewQuery ) {

              _parentCheckedNotifiers.push(
                ()=>requiredCtrl._ngOnChildrenChanged(
                  ChildrenChangeHook.FromView,
                  [ requiredCtrl.ngAfterViewChecked.bind( requiredCtrl ) ]
                )
              );

            }

          } );

      } );

      return [ ...acc, ..._parentCheckedNotifiers ];

    }, [] );

  return ListWrapper.size( parentCheckedNotifiers )
    ? parentCheckedNotifiers
    : [ noop ];

}