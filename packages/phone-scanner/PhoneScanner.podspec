require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'PhoneScanner'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'Proprietary' }
  s.homepage = 'https://github.com/majidsamadi/three-dimension-view'
  s.author = 'WiseStay'
  s.source = { :git => 'https://github.com/majidsamadi/three-dimension-view.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.frameworks = 'ARKit', 'SceneKit', 'AVFoundation'
  s.swift_version = '5.9'
end
