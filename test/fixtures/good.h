// Copyright 2026 Example

#ifndef GOOD_H_
#define GOOD_H_

#include <string>

namespace lab {

class Shape {
 public:
  virtual ~Shape() = default;
  virtual void Draw() const = 0;
};

class Circle : public Shape {
 public:
  void Draw() const override;

 private:
  double radius_ = 1.0;
};

}  // namespace lab

#endif  // GOOD_H_
